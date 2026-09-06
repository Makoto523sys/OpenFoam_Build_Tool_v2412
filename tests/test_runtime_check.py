"""Control-flow tests with explicit command doubles, NOT OpenFOAM execution."""
import gzip
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("runtime_check", ROOT / "src/runtime-check.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)

GOOD_LOG = "Version: v2412\nMesh has 3 geometric (non-empty/wedge) directions (1 1 1)\nMesh OK.\nEnd\n"
NATIVE_DOUBLE = '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
name=Path(sys.argv[0]).name
with Path("command-trace.txt").open("a") as f:f.write(name+" "+" ".join(sys.argv[1:])+"\\n")
if name=="foamDictionary":
    key=sys.argv[1]+":"+sys.argv[sys.argv.index("-entry")+1]
    values=json.loads(Path("native-values.json").read_text())
    if key not in values:print("Missing native fixture "+key,file=sys.stderr);sys.exit(1)
    print(values[key])
elif name=="checkMesh":
    print(Path("check-output.txt").read_text(),end="")
    if os.environ.get("MUTATE_CHECK_MESH"):Path("constant/polyMesh/points").write_text("changed during checking")
    sys.exit(int(os.environ.get("CHECK_EXIT_CODE","0")))
'''


class ParserChecks(unittest.TestCase):
    def test_dictionary_comments_lists_quotes_and_nested_residuals(self):
        d = runtime.parse_dictionary('{ // ignored\n residualControl { p { tolerance 1e-4; relTol 0; } } fields (p U); "a.*" { type symmetry; } }')
        self.assertEqual(d["residualControl"]["p"], {"tolerance": "1e-4", "relTol": "0"})
        self.assertEqual(d["fields"], "( p U )")
        self.assertEqual(runtime.field_patch(d, "abc"), {"type": "symmetry"})

    def test_incomplete_duplicate_and_unexpanded_values_fail_closed(self):
        for text in ("{ p { type fixedValue; }", "{ p 1; p 2; }", "{ #include foo; }", "{ p 2 }"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                runtime.parse_dictionary(text)

    def test_checkmesh_requires_success_and_end_even_with_exit_zero(self):
        for log, code in [("Failed 1 mesh checks.\nEnd\n", 0), ("Mesh OK.\n", 0), ("End\n", 0), (GOOD_LOG, 1), (GOOD_LOG + "FOAM FATAL ERROR", 0)]:
            self.assertTrue(runtime.quality_errors(log, code))
        self.assertEqual(runtime.quality_errors(GOOD_LOG, 0), [])


class RuntimeChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = """const {app}=require('./tests/helpers.cjs');const a=app();a.set('includeSnappy',false);const serial=a.file('Allrun');a.set('includeBlockMesh',false);a.set('nProc','2');const parallel=a.file('Allrun');a.close();process.stdout.write(JSON.stringify({serial,parallel}));"""
        cls.runners = json.loads(subprocess.check_output(["node", "-e", script], cwd=ROOT, text=True))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.case = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        for name in ("system", "0", "constant/polyMesh", "scripts", "bin"):
            (self.case / name).mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / "src/runtime-check.py", self.case / "scripts/validate_case.py")
        for name in ("foamDictionary", "checkMesh", "blockMesh", "pimpleFoam", "decomposePar", "mpirun", "reconstructPar"):
            path = self.case / "bin" / name
            path.write_text(NATIVE_DOUBLE)
            path.chmod(0o755)
        self.environment = {**os.environ, "PATH": str(self.case / "bin") + os.pathsep + os.environ["PATH"], "WM_PROJECT_VERSION": "v2412"}
        for name in ("points", "faces", "owner", "neighbour"):
            (self.case / "constant/polyMesh" / name).write_bytes(b"binary-mesh-placeholder\x00\x01")
        self.mesh = {"walls_walls": ("wall", 10), "symmery_symmery": ("symmetry", 4), "inlet_inlet": ("patch", 2), "outlet_outlet": ("patch", 2), "outlet": ("patch", 0)}
        purposes = {"walls_walls": "wallNoSlip", "symmery_symmery": "symmetry", "inlet_inlet": "velocityInlet", "outlet_outlet": "pressureOutlet", "outlet": "pressureOutlet"}
        self.config = {"version": 1, "solver": "pimpleFoam", "compressible": False, "rho": 998.2, "pressure": "p", "fields": ["U", "p", "k", "omega", "nut"], "patches": [{"name": name, "purpose": purpose, "inletFlow": 50 if purpose == "velocityInlet" else 0, "Q": "0", "mdot": "0"} for name, purpose in purposes.items()], "flow": {"enabled": True, "mode": "auto", "names": ["inlet_inlet", "outlet_outlet", "outlet"], "operation": "sum", "field": "phi", "writeControl": "timeStep", "writeInterval": 1}, "forcePatches": [], "residualFields": ["p", "U", "k", "omega"]}
        self.values = {"system/controlDict:startFrom": "startTime", "system/controlDict:startTime": "0", "system/controlDict:functions": "{ solverInfo1 { type solverInfo; fields (p U k omega); } }", "system/fvSolution:PIMPLE": "{ nOuterCorrectors 1; residualControl { p { tolerance 1e-4; relTol 0; } U { tolerance 1e-5; relTol 0; } } }", "0/U:internalField": "uniform (0 0 0)"}
        self.types = {}
        for field in self.config["fields"]:
            self.types[field] = {name: "symmetry" if mesh[0] == "symmetry" else "fixedValue" if field == "p" and name in ("outlet", "outlet_outlet") else "zeroGradient" for name, mesh in self.mesh.items()}
            (self.case / "0" / field).write_text("Native field contents represented by the foamDictionary double")
        (self.case / "check-output.txt").write_text(GOOD_LOG)
        (self.case / "system/flowMonitors").write_text("old monitor selection")

    def prepare(self):
        boundary = "FoamFile { version 2.0; format binary; class polyBoundaryMesh; object boundary; }\n" + str(len(self.mesh)) + "\n(\n"
        boundary += "\n".join(f"{name} {{ type {typ}; nFaces {count}; startFace 0; }}" for name, (typ, count) in self.mesh.items()) + "\n)\n"
        (self.case / "constant/polyMesh/boundary").write_text(boundary)
        for field, types in self.types.items():
            self.values["0/" + field + ":boundaryField"] = "{ " + " ".join(f"{name} {{ type {typ}; value uniform 0; }}" for name, typ in types.items()) + " }"
        (self.case / "system/caseBuilderChecks.json").write_text(json.dumps(self.config))
        (self.case / "native-values.json").write_text(json.dumps(self.values))

    def run_check(self):
        self.prepare()
        return subprocess.run(["python3", "scripts/validate_case.py"], cwd=self.case, env=self.environment, capture_output=True, text=True)

    def report(self):
        return json.loads((self.case / "case-check-report.json").read_text())

    def test_success_resolves_nonempty_actual_patch_monitors(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.report()["passed"])
        self.assertEqual(self.report()["flowPatches"], ["inlet_inlet", "outlet_outlet"])
        monitors = (self.case / "system/flowMonitors").read_text()
        self.assertIn("patchFlux_inlet_inlet", monitors)
        self.assertIn("patchFlux_outlet_outlet", monitors)
        self.assertIn("names (inlet_inlet outlet_outlet)", monitors)
        self.assertNotIn("patchFlux_outlet\n", monitors)

    def test_missing_manual_patch_names_stop_with_actual_candidates(self):
        self.config["flow"].update(mode="manual", names=["outlet"])
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing or has zero faces: outlet", result.stderr)
        self.assertIn("outlet_outlet", result.stderr)
        self.assertEqual((self.case / "system/flowMonitors").read_text(), "old monitor selection")

    def test_background_pressure_cannot_hide_the_reported_zero_gradient_exit(self):
        self.types["p"]["outlet_outlet"] = "zeroGradient"
        self.config["patches"][3]["purpose"] = "outletZeroGradient"
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Nonzero inflow at inlet_inlet", result.stderr)
        self.assertIn("background outlet with zero faces", result.stderr)

    def test_nonzero_initial_flow_allows_reviewed_pure_neumann_configuration(self):
        self.types["p"]["outlet_outlet"] = "zeroGradient"
        self.values["0/U:internalField"] = "uniform (10 0 0)"
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Pure-Neumann", result.stdout)

    def test_failed_check_with_zero_exit_replaces_old_success_log(self):
        (self.case / "log.checkMesh").write_text(GOOD_LOG)
        (self.case / "case-check-report.json").write_text('{"passed":true}')
        (self.case / "check-output.txt").write_text("482 concave faces.\n5092 concave cells.\nFailed 1 mesh checks.\nEnd\n")
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Mesh OK.", (self.case / "log.checkMesh").read_text())
        self.assertFalse(self.report()["passed"])
        self.assertIn("5092 concave cells.", self.report()["qualitySummary"])

    def test_incomplete_log_never_authorizes_solver(self):
        (self.case / "check-output.txt").write_text("Mesh OK.\n")
        self.assertNotEqual(self.run_check().returncode, 0)
        self.assertFalse(self.report()["passed"])

    def test_nonzero_exit_even_with_success_markers_stops(self):
        self.environment["CHECK_EXIT_CODE"] = "2"
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_mesh_fingerprint_detects_change_during_check(self):
        self.environment["MUTATE_CHECK_MESH"] = "1"
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("mesh changed during checkMesh", result.stderr)
        self.assertNotEqual(self.report()["meshBefore"], self.report()["meshAfter"])

    def test_missing_field_entry_and_constraint_disagreement_are_named(self):
        del self.types["omega"]["inlet_inlet"]
        self.types["U"]["symmery_symmery"] = "noSlip"
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("omega: no boundaryField entry for actual patch inlet_inlet", result.stderr)
        self.assertIn("symmery_symmery: mesh type symmetry disagrees with U type noSlip", result.stderr)

    def test_unregistered_actual_patch_is_not_silently_retyped(self):
        self.mesh["new_surface"] = ("wall", 1)
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("new_surface is not registered", result.stderr)

    def test_symmetry_plane_and_empty_require_matching_native_checks(self):
        self.mesh["symmery_symmery"] = ("empty", 4)
        for field in self.types:
            self.types[field]["symmery_symmery"] = "empty"
        self.config["patches"][1]["purpose"] = "empty"
        self.assertIn("verified two-dimensional mesh", self.run_check().stderr)

    def test_pimple_scalar_residuals_fail_before_solver(self):
        self.values["system/fvSolution:PIMPLE"] = "{ residualControl { p 1e-4; U 1e-5; } }"
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PIMPLE residualControl requires tolerance/relTol dictionary for p", result.stderr)

    def test_simple_scalar_residuals_are_accepted(self):
        self.config["solver"] = "simpleFoam"
        self.values["system/fvSolution:SIMPLE"] = "{ residualControl { p 1e-4; U 1e-5; } }"
        self.assertEqual(self.run_check().returncode, 0)

    def test_residual_monitor_must_be_solverinfo(self):
        self.values["system/controlDict:functions"] = "{ solverInfo1 { type residuals; } }"
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires type solverInfo", result.stderr)

    def test_native_residual_fields_are_validated_after_manual_dictionary_edits(self):
        self.values["system/controlDict:functions"] = "{ solverInfo1 { type solverInfo; fields (p U T); } }"
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not solved in this case: T", result.stderr)

    def test_compressed_binary_header_boundary_is_read(self):
        self.prepare()
        path = self.case / "constant/polyMesh/boundary"
        gz = Path(str(path) + ".gz")
        gz.write_bytes(gzip.compress(path.read_bytes()))
        path.unlink()
        self.assertEqual(runtime.boundary_patches(gz)["outlet_outlet"]["nFaces"], 2)
        self.assertEqual(runtime.mesh_files(self.case, "0")["boundary"], gz)

    def test_allrun_stops_before_parallel_decomposition_on_exit_zero_mesh_failure(self):
        self.prepare()
        (self.case / "Allrun").write_text(self.runners["parallel"])
        (self.case / "check-output.txt").write_text("Failed 1 mesh checks.\nEnd\n")
        result = subprocess.run(["sh", "Allrun"], cwd=self.case, env=self.environment, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        trace = (self.case / "command-trace.txt").read_text()
        self.assertIn("checkMesh ", trace)
        self.assertNotIn("decomposePar", trace)
        self.assertNotIn("mpirun", trace)
        self.assertNotIn("pimpleFoam", trace)

    def test_allrun_executes_fresh_preprocessing_and_solver_after_success(self):
        self.prepare()
        (self.case / "Allrun").write_text(self.runners["serial"])
        (self.case / "log.blockMesh").write_text("stale preprocessing log")
        result = subprocess.run(["sh", "Allrun"], cwd=self.case, env=self.environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        trace = (self.case / "command-trace.txt").read_text()
        self.assertLess(trace.index("blockMesh"), trace.index("checkMesh"))
        self.assertLess(trace.index("checkMesh"), trace.index("pimpleFoam"))
        self.assertNotIn("stale", (self.case / "log.blockMesh").read_text())


if __name__ == "__main__":
    unittest.main()
