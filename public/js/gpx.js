// Lecture d'une trace GPX (export Strava, montre, téléphone) dans le navigateur.

import { localStamp } from '../engine/dates.js';

const EARTH = 6371000;
const rad = (d) => (d * Math.PI) / 180;

function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(h));
}

/** Renvoie une activité prête à importer, ou null si la trace est vide ou sans horodatage. */
export function summarizeGpx(text, fileName) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('fichier GPX illisible');
  const child = (el, name) => {
    for (const c of el.getElementsByTagName('*')) if (c.localName === name) return c.textContent;
    return null;
  };
  const pts = [...doc.getElementsByTagName('trkpt')].map((p) => {
    const time = child(p, 'time');
    const ele = child(p, 'ele');
    const hr = child(p, 'hr');
    const power = child(p, 'power');
    return {
      lat: Number(p.getAttribute('lat')),
      lon: Number(p.getAttribute('lon')),
      t: time ? Date.parse(time) / 1000 : null,
      ele: ele != null ? Number(ele) : null,
      hr: hr != null ? Number(hr) : null,
      power: power != null ? Number(power) : null,
    };
  }).filter((p) => Number.isFinite(p.t));
  if (pts.length < 2) return null;

  let dist = 0;
  let moving = 0;
  let up = 0;
  let ref = pts[0].ele;
  for (let i = 1; i < pts.length; i++) {
    const d = distance(pts[i - 1], pts[i]);
    const dt = pts[i].t - pts[i - 1].t;
    dist += d;
    if (dt > 0 && dt <= 30 && d / dt > 0.5) moving += dt;
    const e = pts[i].ele;
    if (e != null && ref != null) {
      if (e - ref >= 3) { up += e - ref; ref = e; } else if (e < ref) ref = e;
    } else if (e != null) ref = e;
  }
  const elapsed = pts[pts.length - 1].t - pts[0].t;
  const durationSec = Math.round(moving > 60 ? moving : elapsed);
  if (durationSec <= 0) return null;
  const type = (doc.getElementsByTagName('type')[0]?.textContent ?? '').trim().toLowerCase();
  const kmh = (dist / durationSec) * 3.6;
  let sport;
  if (type === '9' || /run|course|trail|jog/.test(type)) sport = 'run';
  else if (type === '1' || /rid|cycl|bik|v[eé]lo/.test(type)) sport = 'bike';
  else sport = kmh > 17 ? 'bike' : 'run';
  const hrs = pts.map((p) => p.hr).filter((v) => v > 0);
  const pows = pts.map((p) => p.power).filter((v) => v != null && v >= 0);
  const mean = (a) => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  const start = localStamp(pts[0].t);
  return {
    id: `file:${fileName}`,
    source: 'file',
    sport,
    name: (doc.getElementsByTagName('name')[0]?.textContent ?? fileName.replace(/\.gpx$/i, '')).slice(0, 80),
    start,
    date: start.slice(0, 10),
    startEpoch: Math.round(pts[0].t),
    durationSec,
    distanceKm: Math.round(dist / 10) / 100,
    elevationM: Math.round(up),
    avgHr: hrs.length ? mean(hrs) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    avgPower: pows.length ? mean(pows) : null,
  };
}
