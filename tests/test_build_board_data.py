# Tests du découpage des blocs (scripts/build_board_data.py) : python3 -m unittest discover -s tests
import importlib.util
import json
import os
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("bbd", os.path.join(ROOT, "scripts", "build_board_data.py"))
bbd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bbd)


def climb(uid, name, setter, holds, stats):
    return {"id": uid, "board": "x", "name": name, "setter": setter, "grade": "", "angle": None,
            "ascents": 0, "stats": stats, "holds": holds}


TYPES = {1: "edge", 2: "edge", 3: "jug", 4: "sloper", 9: "foot_chip"}
CLIMBS = [
    climb("ABCDEF0123456789", "Premier", "alice", [[1, "start"], [2, "hand"], [3, "finish"], [9, "foot"]],
          [[40, "6b/V4", 120, 2.9, 18.4, 1], [45, "6c/V5", 10, None, 20.0, 0]]),
    climb("ABCDEF0199999999", "Deuxième", "bob", [[4, "start"], [3, "hand"]], [[40, "", 5, 3.0, None, 0]]),
    climb("1234", "Court", "alice", [[1, "hand"]], [[30, "5a/V1", 3, 2.0, 13.0, 0]]),
]


class Split(unittest.TestCase):
    def test_fnv1a_vecteurs_standard(self):
        self.assertEqual(bbd.fnv1a(""), 0x811c9dc5)
        self.assertEqual(bbd.fnv1a("a"), 0xe40c292c)
        self.assertEqual(bbd.fnv1a("foobar"), 0xbf9cf968)

    def test_id_court(self):
        self.assertEqual(bbd.short_id_len(["ABCDEF0123", "ABCDEF0199"]), 9)
        self.assertEqual(bbd.short_id_len(["AAAAAAAAAA", "BBBBBBBBBB"]), 8)
        self.assertEqual(bbd.short_id_len(["12", "34"]), 2)

    def test_profil(self):
        self.assertEqual(bbd.hold_profile(CLIMBS[0], TYPES), "e2j1")      # le pied n'est pas compté

    def test_fichiers(self):
        files, desc = bbd.split_climbs(CLIMBS, TYPES)
        self.assertEqual(desc["idLen"], 9)
        self.assertEqual(desc["angles"], {"30": 1, "40": 2, "45": 1})
        self.assertEqual(desc["count"], 3)
        a40 = files["a40.json"]
        self.assertEqual(a40["id"], ["ABCDEF012", "ABCDEF019"])
        self.assertEqual(a40["d"], [184, None])
        self.assertEqual(a40["q"], [29, 30])
        self.assertEqual(a40["bench"], [0])
        self.assertEqual([a40["setters"][i] for i in a40["setter"]], ["alice", "bob"])
        self.assertEqual(len(files["all.json"]["id"]), 3)
        details = {k: v for f, d in files.items() if f.startswith("d/") for k, v in d.items()}
        self.assertEqual(set(details), {"ABCDEF012", "ABCDEF019", "1234"})
        for f, d in files.items():
            if f.startswith("d/"):
                for k in d:
                    self.assertEqual(f, f"d/{bbd.fnv1a(k) % desc['chunks']}.json")

    def test_nombre_de_paquets(self):
        many = [climb(f"{i:032x}", "n", "s", [[1, "hand"]], [[40, "", 3, None, None, 0]]) for i in range(1000)]
        self.assertEqual(bbd.split_climbs(many, TYPES)[1]["chunks"], 4)      # 1000 / 320 ≈ 3,1 -> 4

    def test_ecriture_remplace_le_dossier(self):
        with tempfile.TemporaryDirectory() as out:
            os.makedirs(os.path.join(out, "climbs", "x", "d"))
            open(os.path.join(out, "climbs", "x", "d", "99.json"), "w").write("{}")     # ancien paquet
            open(os.path.join(out, "climbs", "x.json"), "w").write("{}")                # ancien fichier unique
            files, fd = bbd.split_climbs(CLIMBS, TYPES)
            bbd.write_climbs_dir(out, "x", files, fd)
            self.assertFalse(os.path.exists(os.path.join(out, "climbs", "x", "d", "99.json")))
            self.assertFalse(os.path.exists(os.path.join(out, "climbs", "x.json")))
            self.assertEqual(json.load(open(os.path.join(out, "climbs", "x", "meta.json")))["idLen"], 9)



def entry(i, holes=100, outlines=100, typed=100, count=1000):
    return {"id": i, "name": i.upper(), "holes": holes, "outlines": outlines, "typed": typed, "climbCount": count}


OLD = {"generated": "hier", "boards": [entry("a"), entry("b", count=0)]}


class Checks(unittest.TestCase):
    def test_rien_a_signaler(self):
        self.assertEqual(bbd.check_manifest([entry("a"), entry("b", count=10)], OLD), [])
        self.assertEqual(bbd.check_manifest([entry("a", holes=120, count=600), entry("b", count=10)], OLD), [])

    def test_prises_contours_types_perdus(self):
        p = bbd.check_manifest([entry("a", holes=99, outlines=0, typed=50), entry("b", count=10)], OLD)
        self.assertEqual(len(p), 3)
        self.assertIn("A : prises 100 → 99.", p)
        self.assertIn("A : contours 100 → 0.", p)

    def test_blocs(self):
        self.assertEqual(bbd.check_manifest([entry("a", count=499), entry("b", count=10)], OLD),
                         ["A : blocs 1000 → 499 (moins de la moitié)."])
        # blocs générés avec une limite, ou pas générés : pas de contrôle des blocs
        self.assertEqual(bbd.check_manifest([entry("a", count=0), entry("b", count=0)], OLD, climbs=False), [])

    def test_board_absente_ou_vide(self):
        self.assertEqual(bbd.check_manifest([entry("a")], OLD), ["B : board absente (publiée la veille)."])
        self.assertEqual(bbd.check_manifest([entry("a")], OLD, full=False), [])          # --boards a
        self.assertEqual(bbd.check_manifest([entry("c", holes=0, count=0)], None, full=False),
                         ["C : aucune prise.", "C : aucun bloc."])

    def test_reference(self):
        with tempfile.TemporaryDirectory() as d:
            ok, bad = os.path.join(d, "ok.json"), os.path.join(d, "bad.json")
            json.dump(OLD, open(ok, "w"))
            open(bad, "w").write("<html>404</html>")
            self.assertEqual(bbd.load_baseline(ok)["generated"], "hier")
            self.assertIsNone(bbd.load_baseline(bad))
            self.assertIsNone(bbd.load_baseline(os.path.join(d, "absent.json")))

    def test_rapport(self):
        r = bbd.check_report([entry("a", holes=90)], OLD, ["A : prises 100 → 90."])
        self.assertIn("| A | 100 → 90 | 100 | 100 | 1000 |", r)
        self.assertIn("Échec", r)


if __name__ == "__main__":
    unittest.main()
