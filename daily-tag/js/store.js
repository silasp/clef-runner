// localStorage persistence with graceful fallback (private mode etc.).
import { migrate } from './game.js';

const KEY = 'daily-tag:v1';

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage && storage.getItem(KEY);
    return migrate(raw ? JSON.parse(raw) : null);
  } catch (e) {
    return migrate(null);
  }
}

export function save(state, storage = globalThis.localStorage) {
  try { storage && storage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
}

export function exportJson(state) {
  return JSON.stringify(state);
}

export function importJson(text) {
  const obj = JSON.parse(text);
  if (!obj || typeof obj !== 'object' || !obj.cards) throw new Error('Not a Daily Tag backup');
  return migrate(obj);
}

export const STORAGE_KEY = KEY;
