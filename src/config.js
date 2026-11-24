// Rôles des prises dans un bloc, types de prises (CruxCoach) et orientations, formats d'affichage
export const ROLES = {
  start:  {c: 0x22c55e, label: 'Départ'},
  hand:   {c: 0x06b6d4, label: 'Main'},
  finish: {c: 0xd946ef, label: 'Top'},
  foot:   {c: 0xf59e0b, label: 'Pied'}
};
// Types de prises (CruxCoach, CC BY 4.0) : libellé, couleur et modelage 3D
// H = hauteur [petite prise, grosse prise] ; kind = modelage (voir buildHold) ; p = forme du profil (<1 flancs raides)
export const TYPES = {
  jug:       {label: 'bac',      plural: 'bacs',      color: 0xd9a441, H: [0.040, 0.055], kind: 'scoop', p: 0.50, lip: [0.012, 0.022], fw: 0.25},
  edge:      {label: 'réglette', plural: 'réglettes', color: 0x7d8fb8, H: [0.030, 0.045], kind: 'incut', p: 0.50, lip: [0.006, 0.012], fw: 0.22},
  sloper:    {label: 'plat',     plural: 'plats',     color: 0xc47a5f, H: [0.035, 0.050], kind: 'flat',  p: 0.28, fw: 0.50},
  pinch:     {label: 'pince',    plural: 'pinces',    color: 0x8cab69, H: [0.045, 0.065], kind: 'dome',  p: 0.40, fw: 0.45},
  pocket:    {label: 'trou',     plural: 'trous',     color: 0xa07cc0, H: [0.040, 0.055], kind: 'bowl',  p: 0.50, fw: 0.20},
  volume:    {label: 'volume',   plural: 'volumes',   color: 0x8a919b, H: [0.060, 0.100], kind: 'dome',  p: 0.80, fw: 0.40},
  foot_chip: {label: 'prise de pied', plural: 'prises de pied', color: 0x55606c, H: [0.016, 0.024], kind: 'dome', p: 0.60, fw: 0.35}
};
export const DEFAULT_PROFILE = {H: [0.030, 0.045], kind: 'dome', p: 0.75, fw: 0.30};
export const DIRS = {up: [0, 1, 'vers le haut'], down: [0, -1, 'vers le bas'], left: [-1, 0, 'vers la gauche'], right: [1, 0, 'vers la droite'],
  'up-left': [-0.707, 0.707, 'vers le haut à gauche'], 'up-right': [0.707, 0.707, 'vers le haut à droite'],
  'down-left': [-0.707, -0.707, 'vers le bas à gauche'], 'down-right': [0.707, -0.707, 'vers le bas à droite'], all_round: [0, 0, 'toutes directions']};
export const fmt = (v, d = 2) => v.toFixed(d).replace('.', ',');
export const nf = new Intl.NumberFormat('fr-FR');
