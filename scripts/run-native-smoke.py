#!/usr/bin/env python3
"""Execute generated smoke cases with REAL OpenCFD v2412, never command doubles."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def series(case, function):
    rows = []
    for path in sorted((case / "postProcessing" / function).glob("**/*.dat")):
        for line in path.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                values = line.split()
                try:
                    rows.append((float(values[0]), float(values[-1])))
                except ValueError:
                    pass
    if not rows:
        raise RuntimeError(f"No numerical monitor output: {case.name}/{function}")
    return sorted(rows)


def main(root):
    if os.environ.get("WM_PROJECT_VERSION") != "v2412":
        raise RuntimeError("Source OpenCFD OpenFOAM v2412 before running this script")
    for tool in ("foamDictionary", "checkMesh", "pimpleFoam", "simpleFoam", "icoFoam", "interFoam"):
        if not shutil.which(tool):
            raise RuntimeError("Missing real OpenFOAM executable: " + tool)
    results = []
    for name in ("pimple-one", "pimple-three", "simple", "piso", "vof", "stl-channel"):
        case = root / name
        print("Running " + name, flush=True)
        with (case / "log.native-acceptance").open("w") as log:
            subprocess.run(["sh", "Allrun"], cwd=case, stdout=log, stderr=subprocess.STDOUT, check=True)
        checks = json.loads((case / "case-check-report.json").read_text())
        if not checks["passed"]:
            raise RuntimeError(name + ": case checks did not pass")
        config = json.loads((case / "system/caseBuilderChecks.json").read_text())
        log = (case / ("log." + config["solver"])).read_text(errors="replace")
        if not re.search(r"^\s*End\s*$", log, re.M) or re.search(r"FOAM FATAL|Unknown function type|No matching patches", log):
            raise RuntimeError(name + ": solver did not complete normally")
        residual_files = list((case / "postProcessing/solverInfo1").glob("**/*.dat"))
        residual_rows = [line for file in residual_files for line in file.read_text().splitlines()
                         if re.match(r"\s*[+-]?(?:\d|\.\d)", line)]
        if not residual_rows:
            raise RuntimeError(name + ": solverInfo did not write numerical time records")
        inlet = "inlet_inlet" if name == "stl-channel" else "inlet"
        outlet = "outlet_outlet" if name == "stl-channel" else "outlet"
        qin, qout = series(case, "patchFlux_" + inlet)[-1], series(case, "patchFlux_" + outlet)[-1]
        balance = series(case, "flowBalance")[-1]
        if qin[1] >= 0 or qout[1] <= 0:
            raise RuntimeError(name + ": unexpected flow signs")
        if qin[0] != qout[0] or qin[0] != balance[0] or abs(qin[1] + qout[1] - balance[1]) > 1e-5 * max(abs(qin[1]), abs(qout[1])):
            raise RuntimeError(name + ": monitor times or signed sums disagree")
        results.append({"case": name, "solver": config["solver"], "time": qin[0], "inlet": qin[1], "outlet": qout[1], "balance": balance[1], "mesh": checks["meshAfter"]})
        (root / "native-results.json").write_text(json.dumps(results, indent=2) + "\n")
    print("Native smoke cases completed. This is a startup/monitoring check, not physical validation.")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "native-smoke").resolve())
