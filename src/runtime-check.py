#!/usr/bin/env python3
"""Validate a freshly checked OpenCFD v2412 mesh before decomposition/solving.

Emitted into each generated case as scripts/validate_case.py. Python 3 standard
library only; foamDictionary handles native field formats and include expansion.
This checks setup consistency, not physical validation or long-time stability.
"""
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

CONSTRAINTS = {"symmetry", "symmetryPlane", "empty", "wedge", "cyclic", "cyclicAMI"}
PRESSURE_TYPES = {"fixedValue", "totalPressure", "prghPressure", "prghTotalPressure", "uniformFixedValue"}
FLOW_INLETS = {"velocityInlet", "volumetricFlowRateInlet", "massFlowRateInlet"}
FLOW_OUTLETS = {"volumetricFlowRateOutlet", "massFlowRateOutlet"}


def tokens(text):
    # Retain quoted words and remove comments only outside quotes.
    pattern = r'"(?:\\.|[^"\\])*"|/\*[\s\S]*?\*/|//[^\n]*|[{}();\[\]]|[^\s{}();\[\]"]+'
    return [t for t in re.findall(pattern, text) if not t.startswith(("//", "/*"))]


def word(token):
    return token[1:-1] if token.startswith('"') and token.endswith('"') else token


def dictionary(seq, pos=0, enclosed=True):
    if enclosed:
        if pos >= len(seq) or seq[pos] != "{":
            raise ValueError("Expected a dictionary")
        pos += 1
    result = {}
    while pos < len(seq):
        if seq[pos] == "}":
            if not enclosed:
                raise ValueError("Unexpected closing dictionary")
            return result, pos + 1
        key = word(seq[pos])
        pos += 1
        if key.startswith(("#", "$")):
            raise ValueError("Unexpanded dictionary directive: " + key)
        if key in result:
            raise ValueError("Duplicate dictionary key: " + key)
        if pos < len(seq) and seq[pos] == "{":
            result[key], pos = dictionary(seq, pos)
            if pos < len(seq) and seq[pos] == ";":
                pos += 1
        else:
            value, depth = [], 0
            while pos < len(seq):
                t = seq[pos]
                pos += 1
                if t == ";" and depth == 0:
                    break
                if t in ("(", "["):
                    depth += 1
                elif t in (")", "]"):
                    depth -= 1
                if depth < 0 or (t == "}" and depth == 0):
                    raise ValueError("Malformed dictionary value: " + key)
                value.append(t)
            else:
                raise ValueError("Unterminated dictionary entry: " + key)
            result[key] = " ".join(value)
    if enclosed:
        raise ValueError("Unclosed dictionary")
    return result, pos


def parse_dictionary(text):
    seq = tokens(text)
    if not seq:
        raise ValueError("Empty dictionary output")
    result, end = dictionary(seq, enclosed=seq[0] == "{")
    if seq[end:] not in ([], [";"]):
        raise ValueError("Unexpected trailing dictionary output")
    return result


def existing_file(path):
    if path.is_file():
        return path
    zipped = Path(str(path) + ".gz")
    return zipped if zipped.is_file() else None


def read_text(path):
    data = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
    return data.decode("utf-8")


def boundary_patches(path):
    # polyBoundaryMesh is a list of textual patch dictionaries even when the
    # mesh points/faces use binary format. Compressed boundary files are accepted.
    seq = tokens(read_text(path))
    pos = 0
    if seq and seq[0] == "FoamFile":
        _, pos = dictionary(seq, 1)
    if pos + 1 >= len(seq) or not seq[pos].isdigit() or seq[pos + 1] != "(":
        raise ValueError("Cannot read polyMesh/boundary patch list")
    count, pos = int(seq[pos]), pos + 2
    patches = {}
    for _ in range(count):
        name = word(seq[pos])
        values, pos = dictionary(seq, pos + 1)
        if name in patches:
            raise ValueError("Duplicate mesh patch: " + name)
        nfaces = int(values["nFaces"])
        if nfaces < 0:
            raise ValueError("Negative face count: " + name)
        patches[name] = {"type": values["type"], "nFaces": nfaces}
    if seq[pos:] not in ([")"], [")", ";"]):
        raise ValueError("Incomplete or extra polyMesh/boundary entries")
    return patches


def foam_value(case, path, entry):
    proc = subprocess.run(["foamDictionary", str(path), "-entry", entry, "-value"], cwd=case,
                          capture_output=True, text=True, timeout=60)
    if proc.returncode:
        raise ValueError(f"foamDictionary failed: {path} / {entry}\n{proc.stderr.strip()}")
    return proc.stdout.strip()


def initial_time(case):
    mode = foam_value(case, "system/controlDict", "startFrom")
    times = []
    for directory in case.iterdir():
        if directory.is_dir() and re.fullmatch(r"[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", directory.name):
            times.append((float(directory.name), directory.name))
    times.sort()
    if mode in ("latestTime", "firstTime"):
        if not times:
            raise ValueError("No time directories for " + mode)
        return times[-1 if mode == "latestTime" else 0][1]
    if mode != "startTime":
        raise ValueError("Unsupported startFrom: " + mode)
    target = float(foam_value(case, "system/controlDict", "startTime"))
    found = [name for value, name in times if value == target]
    if len(found) != 1:
        raise ValueError(f"Exactly one initial-field directory is required at startTime={target}")
    return found[0]


def mesh_files(case, time_name):
    instances = []
    for directory in case.iterdir():
        try:
            value = float(directory.name)
        except ValueError:
            continue
        if directory.is_dir() and value <= float(time_name):
            instances.append((value, directory.name))
    roots = [case / name / "polyMesh" for _, name in sorted(instances, reverse=True)]
    roots.append(case / "constant/polyMesh")
    result = {}
    for name in ("points", "faces", "owner", "neighbour", "boundary"):
        found = next((p for root in roots if (p := existing_file(root / name))), None)
        if found is None:
            raise ValueError("Missing mesh file: " + name)
        result[name] = found
    return result


def fingerprint(case, files):
    result = {}
    for name, path in files.items():
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        result[name] = {"path": str(path.relative_to(case)), "sha256": digest.hexdigest()}
    return result


def quality_errors(log, returncode):
    errors = []
    if returncode != 0:
        errors.append(f"checkMesh returned {returncode}; see log.checkMesh")
    if re.search(r"Failed\s+\d+\s+mesh checks", log):
        errors.append("checkMesh reports failed mesh checks; inspect concaveCells/concaveFaces and log.checkMesh")
    if not re.search(r"^\s*Mesh OK\.\s*$", log, re.M):
        errors.append("checkMesh success marker 'Mesh OK.' was not found")
    if not re.search(r"^\s*End\s*$", log, re.M) or re.search(r"FOAM FATAL|FOAM exiting|Segmentation fault", log):
        errors.append("Normal checkMesh completion could not be confirmed")
    return errors


def type_of(entry):
    return entry.get("type", "") if isinstance(entry, dict) else ""


def field_patch(boundary, name):
    # Generated fields use exact names. A native foamDictionary expansion has
    # already resolved includes; support explicit regex entries for hand edits.
    if name in boundary:
        return boundary[name]
    matches = []
    for pattern, value in boundary.items():
        try:
            if re.fullmatch(pattern, name):
                matches.append(value)
        except re.error:
            pass
    if len(matches) > 1:
        raise ValueError("Ambiguous boundaryField patterns for " + name)
    return matches[0] if matches else None


def boundary_errors(config, active, fields, internal_u):
    errors, notes = [], []
    settings = {p["name"]: p for p in config["patches"]}
    for name, mesh in active.items():
        if name not in settings:
            errors.append(f"Actual mesh patch {name} is not registered in the builder; assign its intended condition")
        for field, boundary in fields.items():
            entry = field_patch(boundary, name)
            if entry is None:
                errors.append(f"{field}: no boundaryField entry for actual patch {name}")
                continue
            if mesh["type"] in CONSTRAINTS and type_of(entry) != mesh["type"]:
                errors.append(f"{name}: mesh type {mesh['type']} disagrees with {field} type {type_of(entry)}")
            if type_of(entry) in CONSTRAINTS and type_of(entry) != mesh["type"]:
                errors.append(f"{name}: {field} constraint {type_of(entry)} requires matching mesh type")
        if name in settings:
            purpose = settings[name]["purpose"]
            expected = purpose if purpose in CONSTRAINTS else "wall" if "wall" in purpose.lower() else "patch"
            if mesh["type"] != expected:
                errors.append(f"{name}: registered purpose {purpose} requires mesh type {expected}, found {mesh['type']}")
    pressure = fields.get(config["pressure"], {})
    fixed = [name for name in active if type_of(field_patch(pressure, name)) in PRESSURE_TYPES]
    notes.append("Active pressure-reference patches: " + (", ".join(fixed) or "none"))
    if not config["compressible"] and not fixed:
        vector = re.fullmatch(r"uniform\s*\(([^()]*)\)", internal_u)
        components = [float(x) for x in vector[1].split()] if vector else []
        zero = len(components) == 3 and all(x == 0 for x in components)
        inlets = [p for name, p in settings.items() if name in active and p["purpose"] in FLOW_INLETS and (p.get("inletFlow") or 0) > 1e-14]
        outlets = [p for name, p in settings.items() if name in active and p["purpose"] in FLOW_OUTLETS]
        qin = sum(p["inletFlow"] for p in inlets)
        qout = sum(float(p["Q"]) if p["purpose"] == "volumetricFlowRateOutlet" else float(p["mdot"]) / config["rho"] for p in outlets)
        balanced = qout > 0 and abs(qin - qout) <= 1e-6 * max(qin, qout)
        if zero and inlets and not balanced:
            errors.append("Nonzero inflow at " + ", ".join(p["name"] for p in inlets) +
                          " with zero internal U and no active pressure boundary / balanced prescribed outflow. "
                          "A background outlet with zero faces cannot provide a pressure condition. "
                          "Review the actual outlet pressure and initialization; pRefCell does not create outflow.")
        elif inlets:
            notes.append("Pure-Neumann pressure: verify flux compatibility and initialization; the reference cell only fixes the pressure gauge")
    return errors, notes


def flow_selection(config, active):
    flow = config["flow"]
    if not flow["enabled"]:
        return [], [], []
    names, errors, notes = [], [], []
    for name in flow["names"]:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            errors.append("Invalid flow monitor patch name: " + name)
        elif name in active:
            names.append(name)
        elif flow["mode"] == "manual":
            errors.append("Flow monitor patch missing or has zero faces: " + name + "; active patches: " + ", ".join(active))
        else:
            notes.append("Automatic flow monitor omitted absent/zero-face patch: " + name)
    if flow["mode"] == "manual" and not flow["names"]:
        errors.append("Manual flow monitoring requires at least one patch")
    return names, errors, notes


def flow_dictionary(flow, names):
    def obj(name, patches, operation):
        region = "name " + patches[0] if len(patches) == 1 else "names (" + " ".join(patches) + ")"
        return (f"{name}\n{{\n    type surfaceFieldValue;\n    libs (fieldFunctionObjects);\n"
                f"    writeControl {flow['writeControl']};\n    writeInterval {flow['writeInterval']};\n"
                f"    regionType patch;\n    {region};\n    operation {operation};\n"
                f"    fields ({flow['field']});\n    writeFields false;\n}}\n")
    result = "// Resolved by validate_case.py against nonempty actual mesh patches.\n"
    result += "\n".join(obj("patchFlux_" + n, [n], flow["operation"]) for n in names)
    if len(names) > 1 and flow["operation"] == "sum":
        result += obj("flowBalance", names, "sum")
    return result


def validate(case):
    report = {"started": datetime.datetime.now(datetime.timezone.utc).isoformat(), "errors": [], "notes": []}
    errors, notes = report["errors"], report["notes"]
    (case / "case-check-report.json").write_text(json.dumps({**report, "passed": False, "inProgress": True}, indent=2) + "\n")
    try:
        if os.environ.get("WM_PROJECT_VERSION") != "v2412":
            raise ValueError("Source OpenCFD OpenFOAM v2412 before checking this case")
        config = json.loads((case / "system/caseBuilderChecks.json").read_text())
        start = initial_time(case)
        files = mesh_files(case, start)
        report["time"] = start
        report["meshBefore"] = fingerprint(case, files)
        command = ["checkMesh", "-time", start, "-allTopology", "-allGeometry", "-writeSets", "vtk", "-noFunctionObjects"]
        report["command"] = command
        # Open with 'w' on EVERY run; never accept a RunFunctions-cached log.
        with (case / "log.checkMesh").open("w") as log:
            proc = subprocess.run(command, cwd=case, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        log = (case / "log.checkMesh").read_text(errors="replace")
        report["openfoamHeader"] = [line.strip() for line in log.splitlines() if re.match(r"\s*(Build|Version|Arch|Exec)\s*:", line)]
        errors.extend(quality_errors(log, proc.returncode))
        report["meshAfter"] = fingerprint(case, mesh_files(case, start))
        if report["meshBefore"] != report["meshAfter"]:
            errors.append("The mesh changed during checkMesh; this result cannot authorize a solver run")
        report["qualitySummary"] = [line.strip() for line in log.splitlines() if re.search(r"concave|non-orthogon|skewness|Failed|Mesh OK", line, re.I)]
        patches = boundary_patches(files["boundary"])
        active = {name: p for name, p in patches.items() if p["nFaces"] > 0}
        if not active:
            errors.append("No nonempty mesh patches found")
        report["patches"] = patches
        fields = {}
        for field in config["fields"]:
            if not existing_file(case / start / field):
                errors.append(f"Missing initial field: {start}/{field}")
                continue
            try:
                fields[field] = parse_dictionary(foam_value(case, start + "/" + field, "boundaryField"))
            except ValueError as error:
                errors.append(str(error))
        internal_u = foam_value(case, start + "/U", "internalField") if "U" in fields else ""
        found_errors, found_notes = boundary_errors(config, active, fields, internal_u)
        errors.extend(found_errors)
        notes.extend(found_notes)
        names, found_errors, found_notes = flow_selection(config, active)
        errors.extend(found_errors)
        notes.extend(found_notes)
        report["flowPatches"] = names
        for name in config.get("wallSamplePatches", []):
            if name not in active or active[name]["type"] != "wall":
                errors.append("Wall sampling requires a nonempty wall patch: " + name)
        for pattern in config["forcePatches"]:
            try:
                matched = any(re.fullmatch(pattern, n) for n in active)
            except re.error:
                matched = False
            if not matched:
                errors.append("Force monitor has no nonempty matching patch: " + pattern)
        if any(p["type"] == "empty" for p in active.values()) and not re.search(r"Mesh has\s+2\s+geometric", log):
            errors.append("empty patches require a verified two-dimensional mesh; checkMesh did not confirm 2 geometric directions")
        algorithm = "SIMPLE" if config["solver"] == "simpleFoam" else "PISO" if config["solver"] == "icoFoam" else "PIMPLE"
        solution = parse_dictionary(foam_value(case, "system/fvSolution", algorithm))
        if algorithm == "PIMPLE":
            for field, entry in solution.get("residualControl", {}).items():
                if not isinstance(entry, dict) or not {"tolerance", "relTol"} <= entry.keys():
                    errors.append("PIMPLE residualControl requires tolerance/relTol dictionary for " + field)
        if not errors:
            # Only automatic monitoring selection is resolved, never patch purposes
            # or initial conditions. Manual missing references have already failed.
            target = case / "system/flowMonitors"
            target.write_text(flow_dictionary(config["flow"], names))
            # Native parsing also checks the included flow monitor dictionary.
            functions = parse_dictionary(foam_value(case, "system/controlDict", "functions"))
            if config["residualFields"] and type_of(functions.get("solverInfo1")) != "solverInfo":
                errors.append("Residual monitoring requires type solverInfo in OpenCFD v2412")
            elif config["residualFields"]:
                allowed = set(config["fields"]) & {config["pressure"], "U", "k", "epsilon", "omega", "nuTilda"}
                if config["compressible"]:
                    allowed.add("h")
                elif config["solver"] == "buoyantBoussinesqPimpleFoam":
                    allowed.add("T")
                selected = [word(t) for t in tokens(functions["solverInfo1"].get("fields", "")) if t not in ("(", ")")]
                if not selected:
                    errors.append("solverInfo requires at least one monitored field")
                for field in selected:
                    if field not in allowed:
                        errors.append("solverInfo field is not solved in this case: " + field)
    except (OSError, ValueError, KeyError, IndexError, subprocess.SubprocessError) as error:
        errors.append(str(error))
    report["passed"] = not errors
    (case / "case-check-report.json").write_text(json.dumps(report, indent=2) + "\n")
    for note in notes:
        print("CHECK: " + note)
    for error in errors:
        print("ERROR: " + error, file=sys.stderr)
    print("Case checks " + ("passed" if not errors else "FAILED") + "; see case-check-report.json and log.checkMesh")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(validate(Path(__file__).resolve().parents[1]))
