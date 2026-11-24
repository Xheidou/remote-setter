#!/usr/bin/env python3
"""
build_board_data.py — produit en UNE commande les données de Board 3D.

    npm run data                 (= python3 scripts/build_board_data.py)

Résultat, dans public/data/ (servi tel quel par le site) :
    index.json              manifeste : boards, sources, versions, date de génération
    boards/<id>.json        géométrie d'une board : prises (position, teinte, type, orientation), contours
    climbs/<id>.json        blocs d'une board (les plus répétés), avec cotation et répétitions par angle

Variante : --out fichier.json écrit un fichier unique, importable dans la page (« Importer un fichier »).

Aucune dépendance : Python 3.9+ uniquement (plus besoin de BoardLib).

Sources (toutes publiques) :
  * Géométrie des trous et contours détourés des prises : dépôt GitHub de Boardsesh
    (code sous licence Apache-2.0) — github.com/boardsesh/boardsesh
  * Blocs et statistiques : snapshots nocturnes publics de Boardsesh
    https://snapshots.boardsesh.com/board-snapshots/v1-gzip/manifest.json
Les fichiers téléchargés sont gardés dans ./cache et réutilisés tant qu'ils n'ont pas changé.

Options utiles :
  --boards kilter-original,moonboard-2016   ne construire que certaines boards
  --limit 1500                              blocs gardés par board (les plus grimpés), 0 = tous
  --min-ascents 3                           ignorer les blocs moins répétés
  --no-climbs                               géométrie seule (rapide, aucun gros téléchargement)
  --repo-dir chemin/vers/boardsesh          utiliser un clone local du dépôt au lieu de GitHub
  --no-types                                sans les types de prises (CruxCoach)
  --list                                    afficher les boards disponibles
  --out-dir public/data                     dossier de sortie (défaut)
  --cache .cache/board-data                 cache des téléchargements (défaut)

Types de prises (bac, réglette, plat, pince, trou, volume, pied) et orientation : CruxCoach,
licence CC BY 4.0, à créditer. Étiquettes encore en cours de validation par leur projet.

Conditions Boardsesh : on télécharge les snapshots et on héberge soi-même le résultat ; ne pas
appeler leurs serveurs depuis une app publique. Créditer les ouvreurs (le champ setter est conservé).
Les contours de prises sont détourés à partir des images des boards : vérifier les droits avant
toute diffusion publique.
"""
import argparse
import gzip
import json
import math
import os
import re
import shutil
import sqlite3
import sys
import time
import urllib.request

IN = 0.0254
RAW = "https://raw.githubusercontent.com/boardsesh/boardsesh/{ref}/{path}"
MANIFESTS = [
    "https://snapshots.boardsesh.com/board-snapshots/v1-gzip/manifest.json",
    "https://boardsesh-board-snapshots.t3.tigrisfiles.io/board-snapshots/v1/manifest.json",
]
HOLES_PATH = "packages/board-constants/src/generated/hole-placements/{board}.cjs"
OUTLINE_PATH = "packages/shared/board-art-geometry/src/generated/{board}/{layout}-{size}.cjs"
# Types de prises (jug, edge, sloper, pinch, pocket, volume, foot_chip) + orientation : CruxCoach, CC BY 4.0
TYPES_RAW = "https://raw.githubusercontent.com/CruxCoach/CruxCoach/{ref}/androidApp/src/main/assets/hold_types/{board}.json"
TYPES_CREDIT = "Hold types by CruxCoach (https://github.com/CruxCoach/CruxCoach), CC BY 4.0"
# Les fichiers de types n'existent pour l'instant que dans la demande de fusion n° 95 de CruxCoach (pas sur
# une branche) : on lit ce commit précis. À mettre à jour quand leurs étiquettes seront fusionnées ou validées.
TYPES_REF = "a9fc009c8a4fc66b19c880994541e396ed894d1d"

# Rôles des prises (codes des frames "p<placement>r<rôle>"), d'après Boardsesh hold-states.ts
ROLE_CODES = {
    "kilter": {**{c: r for base in (12, 20, 24, 28, 32, 42)
                  for c, r in zip(range(base, base + 4), ("start", "hand", "finish", "foot"))},
               **{c: "hand" for c in range(36, 42)}},
    "tension": {1: "start", 2: "hand", 3: "finish", 4: "foot", 5: "start", 6: "hand", 7: "finish", 8: "foot"},
    "moonboard": {42: "start", 43: "hand", 44: "finish", 45: "foot", 46: "hand", 47: "hand", 48: "hand"},
}
GRADES = {10: "4a/V0", 11: "4b/V0", 12: "4c/V0", 13: "5a/V1", 14: "5b/V1", 15: "5c/V2", 16: "6a/V3",
          17: "6a+/V3", 18: "6b/V4", 19: "6b+/V4", 20: "6c/V5", 21: "6c+/V5", 22: "7a/V6", 23: "7a+/V7",
          24: "7b/V8", 25: "7b+/V8", 26: "7c/V9", 27: "7c+/V10", 28: "8a/V11", 29: "8a+/V12",
          30: "8b/V13", 31: "8b+/V14", 32: "8c/V15", 33: "8c+/V16"}

# ---------------------------------------------------------------------------------------------
# Boards. Unités Aurora = pouces. Bords (edges) = taille de board dans Boardsesh (product sizes).
# kicker_top : coordonnée y où commence le panneau incliné ; en dessous, les prises sont sur le
#              kicker vertical.
# kicker     : hauteur exposée du kicker en mètres [défaut, min, max] — varie selon l'installation.
# Dimensions physiques : fabricants (kiltergrips.com, settercloset.com, moonclimbing.com).
# ---------------------------------------------------------------------------------------------
BOARDS = {
    "kilter-original": dict(
        name="Kilter Board Original 12×12", maker="Kilter", board="kilter", layout=1, size=10, sets=[1, 20],
        edges=(0, 144, 0, 156), kicker_top=12, width_in=144, panel_in=144, kicker=[0.46, 0.46, 0.91],
        note="12' × 12' + kicker exposé de 1,5 à 3' (Kilter)"),
    "kilter-homewall": dict(
        name="Kilter Board Homewall 10×12 (Full Ride)", maker="Kilter", board="kilter", layout=8, size=25,
        sets=[26, 27, 28, 29], edges=(-56, 56, -12, 144), kicker_top=0, width_in=120, panel_in=144,
        kicker=[0.38, 0.30, 0.46], note="10' × 12' + kicker réglable de 12 à 18\" (Kilter)"),
    "tension-1": dict(
        name="Tension Board 1 (mur complet)", maker="Tension", board="tension", layout=9, size=1,
        sets=[8, 9, 10, 11], edges=(0, 96, 0, 156), kicker_top=10, width_in=96, panel_in=146,
        kicker=[0.30, 0.25, 0.60], note="8' de large ; hauteur du kicker non publiée (estimée)"),
    "tension-2-mirror": dict(
        name="Tension Board 2 Mirror 12×12", maker="Tension", board="tension", layout=10, size=6,
        sets=[12, 13], edges=(-68, 68, 0, 144), kicker_top=0, width_in=144, panel_in=144,
        kicker=[0.30, 0.20, 0.60], note="12' × 12' ; hauteur du kicker non publiée (estimée)"),
    "tension-2-spray": dict(
        name="Tension Board 2 Spray 12×12", maker="Tension", board="tension", layout=11, size=6,
        sets=[12, 13], edges=(-68, 68, 0, 144), kicker_top=0, width_in=144, panel_in=144,
        kicker=[0.30, 0.20, 0.60], note="12' × 12' ; hauteur du kicker non publiée (estimée)"),
    "moonboard-2016": dict(name="MoonBoard 2016", maker="Moon", board="moonboard", layout=2, size=1),
    "moonboard-2024": dict(name="MoonBoard 2024", maker="Moon", board="moonboard", layout=3, size=1),
    "moonboard-masters-2017": dict(name="MoonBoard Masters 2017", maker="Moon", board="moonboard", layout=4, size=1),
    "moonboard-masters-2019": dict(name="MoonBoard Masters 2019", maker="Moon", board="moonboard", layout=5, size=1),
}
# MoonBoard standard : 2,44 m de large, grille 11 × 18 au pas de 20 cm, kicker 370 mm, 40° ou 25°,
# hauteur totale 3,15 m à 40° -> panneau ≈ 3,63 m (Moon Climbing, guide de construction).
MOON = dict(width=2.44, panel=3.63, kicker=[0.37, 0.37, 0.37], pitch=0.20, cols=11, rows=18,
            note="2,44 m × 3,15 m à 40°, kicker 370 mm, grille au pas de 20 cm (Moon Climbing)")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ------------------------------------------------------------------------------ téléchargements
def http_get(url, dest=None, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "board3d-data/2", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if dest is None:
            data = r.read()
            return gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data
        tmp = dest + ".part"
        with open(tmp, "wb") as f:
            shutil.copyfileobj(r, f, 1 << 20)
    with open(tmp, "rb") as f:
        magic = f.read(2)
    if magic == b"\x1f\x8b":
        with gzip.open(tmp, "rb") as src, open(dest, "wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        os.remove(tmp)
    else:
        os.replace(tmp, dest)
    return dest


class Repo:
    """Lit les fichiers du dépôt Boardsesh, en local (--repo-dir) ou depuis GitHub (mis en cache)."""

    def __init__(self, repo_dir, ref, cache):
        self.dir, self.ref, self.cache = repo_dir, ref, cache
        self.mem = {}

    def text(self, path):
        if path in self.mem:
            return self.mem[path]
        if self.dir:
            full = os.path.join(self.dir, path)
            txt = open(full, encoding="utf-8").read() if os.path.exists(full) else None
        else:
            local = os.path.join(self.cache, "repo", self.ref, path)
            if not os.path.exists(local):
                os.makedirs(os.path.dirname(local), exist_ok=True)
                try:
                    data = http_get(RAW.format(ref=self.ref, path=path))
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        self.mem[path] = None
                        return None
                    raise
                with open(local, "wb") as f:
                    f.write(data)
            txt = open(local, encoding="utf-8").read()
        self.mem[path] = txt
        return txt


# ------------------------------------------------------------------------------ parsing Boardsesh
def parse_hole_placements(txt):
    """hole-placements/<board>.cjs -> {'layout-set': [(placementId, x, y), ...]}"""
    out, cur = {}, None
    for line in txt.splitlines():
        m = re.match(r"\s+'(\d+-\d+)': \[", line)
        if m:
            cur = out.setdefault(m.group(1), [])
            continue
        m = re.match(r"\s+\[(\d+), (?:null|\d+), (-?[\d.]+), (-?[\d.]+)\]", line)
        if m and cur is not None:
            cur.append((int(m.group(1)), float(m.group(2)), float(m.group(3))))
    return out


def parse_outline_shard(txt):
    """board-art-geometry/<board>/<layout>-<size>.cjs -> (outlines{id:[...]}, lightness{id:L})"""
    outlines, light, section = {}, {}, None
    for line in txt.splitlines():
        m = re.match(r"  (\w+): \{", line)
        if m:
            section = m.group(1)
            continue
        m = re.match(r"\s+(\d+): (.+?),?$", line)
        if not m:
            continue
        pid, val = int(m.group(1)), m.group(2).rstrip(",")
        if section == "outlines":
            outlines[pid] = json.loads(val)
        elif section == "silhouetteLightness":
            light[pid] = float(val)
    return outlines, light


def outline_to_m(flat, r_m):
    """Contour en unités de rayon (y vers le bas) -> liste plate en mètres (y vers le haut)."""
    pts = []
    for i in range(0, len(flat) - 1, 2):
        pts += [round(flat[i] * r_m, 4), round(-flat[i + 1] * r_m, 4)]
    return pts


# ------------------------------------------------------------------------------ types de prises
class Types:
    """Étiquettes CruxCoach : {(board, layout|None, placement): (type, direction, footOnly)}"""

    def __init__(self, types_dir, ref, cache, enabled):
        self.dir, self.ref, self.cache, self.enabled, self.mem = types_dir, ref, cache, enabled, {}
        self.versions = {}

    def board(self, board):
        if not self.enabled:
            return {}
        if board in self.mem:
            return self.mem[board]
        data = None
        try:
            if self.dir:
                path = os.path.join(self.dir, f"{board}.json")
                data = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else None
            else:
                local = os.path.join(self.cache, "hold_types", self.ref.replace("/", "_"), f"{board}.json")
                if not os.path.exists(local):
                    os.makedirs(os.path.dirname(local), exist_ok=True)
                    with open(local, "wb") as f:
                        f.write(http_get(TYPES_RAW.format(ref=self.ref, board=board)))
                data = json.load(open(local, encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log(f"  ! types de prises indisponibles pour {board} : {e}")
        out = {}
        if data and data.get("version"):
            self.versions[board] = data["version"]
        for h in (data or {}).get("holds", []):
            key = (h.get("layoutId") if board == "moonboard" else None, h.get("placement"))
            out[key] = (h.get("type") or "", h.get("direction") or "", bool(h.get("footOnly")))
        self.mem[board] = out
        return out


# ------------------------------------------------------------------------------ géométrie
def build_geometry(key, cfg, repo, types):
    board = cfg["board"]
    tmap = types.board(board)
    lay = cfg["layout"] if board == "moonboard" else None

    def tag(pid):
        t = tmap.get((lay, pid))
        return [t[0], t[1], int(t[2])] if t else ["", "", 0]

    shard = repo.text(OUTLINE_PATH.format(board=board, layout=cfg["layout"], size=cfg["size"]))
    outlines, light = parse_outline_shard(shard) if shard else ({}, {})
    if not shard:
        log(f"  ! pas de contours pour {key} : prises affichées en forme générique")

    if board == "moonboard":
        holes, outl = [], {}
        r_m = MOON["pitch"] * 0.525          # rayon de placement Boardsesh = 0,525 × pas de grille
        y0 = (MOON["panel"] - (MOON["rows"] - 1) * MOON["pitch"]) / 2
        for pid in sorted(outlines):         # MoonBoard : seules les cases équipées ont un contour
            col, row = (pid - 1) % MOON["cols"], (pid - 1) // MOON["cols"]
            x = MOON["width"] / 2 + (col - (MOON["cols"] - 1) / 2) * MOON["pitch"]
            holes.append([pid, round(x, 3), round(y0 + row * MOON["pitch"], 3), round(light.get(pid, 0.5), 3), *tag(pid)])
            outl[str(pid)] = outline_to_m(outlines[pid], r_m)
        return dict(width=MOON["width"], panel=MOON["panel"], kicker=MOON["kicker"], note=MOON["note"],
                    holes=holes, outlines=outl, approx="positions de grille reconstruites (pas de 20 cm)")

    placements = parse_hole_placements(repo.text(HOLES_PATH.format(board=board)))
    el, er, eb, et = cfg["edges"]
    cx_units = (el + er) / 2
    r_m = 4 * IN                             # rayon de placement Boardsesh = 4 unités Aurora
    holes, outl, seen = [], {}, set()
    for s in cfg["sets"]:
        for pid, x, y in placements.get(f"{cfg['layout']}-{s}", []):
            if pid in seen or not (el < x < er and eb < y < et):
                continue
            seen.add(pid)
            holes.append([pid, round((x - cx_units) * IN + cfg["width_in"] * IN / 2, 3),
                          round((y - cfg["kicker_top"]) * IN, 3), round(light.get(pid, 0.5), 3), *tag(pid)])
            if pid in outlines:
                outl[str(pid)] = outline_to_m(outlines[pid], r_m)
    return dict(width=round(cfg["width_in"] * IN, 3), panel=round(cfg["panel_in"] * IN, 3),
                kicker=cfg["kicker"], note=cfg["note"], holes=holes, outlines=outl)


# ------------------------------------------------------------------------------ blocs
def load_manifest(cache):
    for url in MANIFESTS:
        try:
            man = json.loads(http_get(url, timeout=60))
            man["_url"] = url
            return man
        except Exception as e:  # noqa: BLE001
            log(f"  manifeste indisponible ({url}) : {e}")
    sys.exit("Impossible de lire le manifeste des snapshots Boardsesh.")


def snapshot_path(man, board, layout, cache):
    entries = [e for e in man.get("entries", [])
               if e.get("boardType") == board and str(e.get("layoutId")) == str(layout)]
    if not entries:
        return None, None
    e = max(entries, key=lambda x: x.get("builtAt", ""))
    url = e.get("url") or man["_url"].rsplit("/board-snapshots/", 1)[0] + "/" + e["key"]
    dest = os.path.join(cache, f"{board}-{layout}.db")
    meta = dest + ".json"
    stamp = e.get("builtAt") or url
    if os.path.exists(dest) and os.path.exists(meta) and json.load(open(meta)).get("stamp") == stamp:
        log(f"  snapshot {board}/{layout} déjà à jour (cache)")
        return dest, stamp
    size = (e.get("bytes") or 0) / 1e6
    log(f"  téléchargement du snapshot {board}/{layout} ({size:.0f} Mo)…")
    t = time.time()
    http_get(url, dest, timeout=1800)
    json.dump({"stamp": stamp}, open(meta, "w"))
    log(f"  ok en {time.time() - t:.0f} s")
    return dest, stamp


def cols(con, table):
    return {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}


def load_climbs(db, key, cfg, known, limit, min_ascents):
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cc = cols(con, "board_climbs")
    where = ["layout_id = ?"]
    if "is_listed" in cc:
        where.append("COALESCE(is_listed, 1) = 1")
    if "is_draft" in cc:
        where.append("COALESCE(is_draft, 0) = 0")
    if "is_hidden" in cc:
        where.append("COALESCE(is_hidden, 0) = 0")
    pick = [c for c in ("uuid", "name", "setter_username", "frames", "angle", "compatible_size_ids") if c in cc]
    climbs = {r["uuid"]: dict(r) for r in con.execute(
        f"SELECT {', '.join(pick)} FROM board_climbs WHERE {' AND '.join(where)}", (cfg["layout"],))}

    stats = {}
    sc = cols(con, "board_climb_stats")
    diff = next((c for c in ("display_difficulty", "difficulty_average") if c in sc), None)
    q = "quality_average" if "quality_average" in sc else "NULL"
    for r in con.execute(f"SELECT climb_uuid, angle, {diff or 'NULL'} AS d, "
                         f"COALESCE(ascensionist_count, 0) AS a, {q} AS q FROM board_climb_stats"):
        if r["climb_uuid"] in climbs and r["a"] >= min_ascents:
            g = GRADES.get(int(round(r["d"]))) if r["d"] is not None else None
            stats.setdefault(r["climb_uuid"], []).append(
                [r["angle"], g or "", r["a"], round(r["q"], 1) if r["q"] is not None else None])

    roles = ROLE_CODES.get(cfg["board"], ROLE_CODES["kilter"])
    out, skipped = [], 0
    for uid, c in climbs.items():
        st = stats.get(uid)
        if not st:
            continue
        sizes = c.get("compatible_size_ids")
        if sizes and cfg["board"] != "moonboard":
            try:
                if cfg["size"] not in json.loads(sizes):
                    continue
            except (TypeError, ValueError):
                pass
        frame = str(c.get("frames") or "").split(",")[0]
        holds = [[int(p), roles.get(int(r), "hand")] for p, r in re.findall(r"p(\d+)r(\d+)", frame)]
        if not holds or any(p not in known for p, _ in holds):
            skipped += 1
            continue
        st.sort(key=lambda s: -s[2])
        out.append({"id": uid, "board": key, "name": c.get("name") or "Sans nom",
                    "setter": c.get("setter_username") or "", "grade": st[0][1], "angle": st[0][0],
                    "ascents": sum(s[2] for s in st), "stats": sorted(st, key=lambda s: s[0]), "holds": holds})
    out.sort(key=lambda x: -x["ascents"])
    if skipped:
        log(f"  {skipped} blocs ignorés (prises hors de cette taille de board)")
    return out[:limit] if limit else out


def angles_from(climbs, board):
    if board == "moonboard":
        vals = sorted({s[0] for c in climbs for s in c["stats"]} & {25, 40}) or [40]
        return {"list": vals, "def": 40 if 40 in vals else vals[0]}
    vals = sorted({s[0] for c in climbs for s in c["stats"] if s[0] is not None})
    if not vals:
        return {"min": 0, "max": 70, "step": 5, "def": 40}
    # plage physique des boards réglables (0–70°), élargie si des blocs existent hors de cette plage
    lo, hi = min(0, vals[0]), max(70, vals[-1])
    return {"min": lo, "max": hi, "step": 5, "def": 40}


# ------------------------------------------------------------------------------ main
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--boards", default="all", help="liste séparée par des virgules, ou 'all'")
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "public", "data"), help="dossier de sortie du site")
    ap.add_argument("--out", default=None, help="écrire plutôt un fichier unique importable (format 2)")
    ap.add_argument("--limit", type=int, default=2000, help="blocs par board (0 = tous)")
    ap.add_argument("--min-ascents", type=int, default=3)
    ap.add_argument("--no-climbs", action="store_true", help="géométrie seule ; garde les blocs déjà générés")
    ap.add_argument("--cache", default=os.path.join(ROOT, ".cache", "board-data"))
    ap.add_argument("--repo-dir", default=None, help="clone local de boardsesh/boardsesh")
    ap.add_argument("--ref", default="main", help="branche ou commit GitHub de Boardsesh")
    ap.add_argument("--types-dir", default=None, help="dossier local des fichiers hold_types de CruxCoach")
    ap.add_argument("--types-ref", default=TYPES_REF, help="commit ou branche CruxCoach contenant hold_types/")
    ap.add_argument("--no-types", action="store_true", help="ne pas ajouter les types de prises")
    ap.add_argument("--allow-missing-types", action="store_true",
                    help="continuer même si les types de prises n'ont pas pu être lus (sinon : échec)")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    if a.list:
        for k, c in BOARDS.items():
            print(f"{k:24} {c['name']}")
        return
    keys = list(BOARDS) if a.boards == "all" else [k.strip() for k in a.boards.split(",")]
    bad = [k for k in keys if k not in BOARDS]
    if bad:
        sys.exit(f"Boards inconnues : {bad}. Voir --list.")
    os.makedirs(a.cache, exist_ok=True)
    repo = Repo(a.repo_dir, a.ref, a.cache)
    types = Types(a.types_dir, a.types_ref, a.cache, not a.no_types)
    man = None if a.no_climbs else load_manifest(a.cache)

    sources = ["Géométrie et contours des prises : github.com/boardsesh/boardsesh (Apache-2.0)",
               "Blocs : snapshots publics Boardsesh — contenu créé par les ouvreurs crédités",
               TYPES_CREDIT + " — étiquettes non encore validées à l'aveugle par le projet"]
    generated = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    boards, climbs, entries = [], [], []
    for k in keys:
        cfg = BOARDS[k]
        log(f"• {cfg['name']}")
        geo = build_geometry(k, cfg, repo, types)
        known = {h[0] for h in geo["holes"]}
        typed = sum(1 for h in geo["holes"] if h[4])
        if not a.no_types and not typed and not a.allow_missing_types:
            sys.exit(f"Aucun type de prise pour {cfg['name']} : source CruxCoach introuvable ({a.types_ref}). "
                     "Génération arrêtée pour ne pas publier des prises sans modelage. "
                     "Corriger --types-ref, ou relancer avec --allow-missing-types.")
        log(f"  {len(geo['holes'])} prises, {len(geo['outlines'])} avec contour réel, {typed} avec un type, "
            f"{geo['width']} m de large, panneau {geo['panel']} m")
        cl, stamp = [], None
        if man:
            db, stamp = snapshot_path(man, cfg["board"], cfg["layout"], a.cache)
            if db:
                cl = load_climbs(db, k, cfg, known, a.limit, a.min_ascents)
                log(f"  {len(cl)} blocs retenus")
            else:
                log("  aucun snapshot pour cette board")
        climbs_path = os.path.join(a.out_dir, "climbs", f"{k}.json")
        kept = None
        if not man and not a.out and os.path.exists(climbs_path):      # --no-climbs : on garde les blocs existants
            kept = json.load(open(climbs_path, encoding="utf-8"))
            cl_for_angles = kept.get("climbs", [])
        else:
            cl_for_angles = cl
        board = {"id": k, "name": cfg["name"], "maker": cfg["maker"], "width": geo["width"],
                 "panel": geo["panel"], "kicker": geo["kicker"],
                 "angles": angles_from(cl_for_angles, cfg["board"]) if cl_for_angles else (
                     {"list": [25, 40], "def": 40} if cfg["board"] == "moonboard"
                     else {"min": 0, "max": 70, "step": 5, "def": 40}),
                 "note": geo["note"], "approx": geo.get("approx"),
                 "holes": geo["holes"], "outlines": geo["outlines"]}
        boards.append(board)
        climbs += cl
        if not a.out:
            size = write_json(os.path.join(a.out_dir, "boards", f"{k}.json"), board)
            n_cl = len(cl)
            if cl:
                size += write_json(climbs_path, {"board": k, "generated": generated, "snapshot": stamp,
                                                 "climbs": [{kk: v for kk, v in c.items() if kk != "board"} for c in cl]})
            elif kept is not None:
                n_cl, stamp = len(kept.get("climbs", [])), kept.get("snapshot")
            entries.append({"id": k, "name": cfg["name"], "maker": cfg["maker"],
                            "geometry": f"boards/{k}.json",
                            "climbs": f"climbs/{k}.json" if (cl or kept is not None) else None,
                            "holes": len(geo["holes"]), "outlines": len(geo["outlines"]), "typed": typed,
                            "climbCount": n_cl, "snapshot": stamp,
                            "holdTypesVersion": types.versions.get(cfg["board"])})
            log(f"  -> {size / 1e3:.0f} ko")

    if a.out:
        size = write_json(a.out, {"format": 2, "generated": generated, "sources": sources, "boards": boards, "climbs": climbs})
        log(f"\nOK -> {a.out} ({size / 1e6:.1f} Mo, {len(boards)} boards, {len(climbs)} blocs)")
        return
    index_path = os.path.join(a.out_dir, "index.json")
    if a.boards != "all" and os.path.exists(index_path):            # mise à jour partielle : on fusionne
        old = json.load(open(index_path, encoding="utf-8"))
        done = {e["id"] for e in entries}
        entries = [e for e in old.get("boards", []) if e["id"] not in done] + entries
        order = list(BOARDS)
        entries.sort(key=lambda e: order.index(e["id"]) if e["id"] in order else 99)
    write_json(index_path, {"format": 3, "generated": generated, "sources": sources,
                            "versions": {"boardsesh": a.ref if not a.repo_dir else "local",
                                         "cruxcoach": a.types_ref if not a.types_dir else "local"},
                            "boards": entries})
    total = sum(e["climbCount"] for e in entries)
    log(f"\nOK -> {a.out_dir} ({len(entries)} boards, {total} blocs)")


if __name__ == "__main__":
    main()
