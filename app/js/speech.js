// Text-to-speech using the device's Norwegian voice (iOS: "Nora"/"Henrik").
import { settings } from './store.js';

let voices = [];
function refresh() {
  try { voices = speechSynthesis.getVoices().filter(v => /^(nb|no|nn)(-|_|$)/i.test(v.lang)); } catch { voices = []; }
}
if ('speechSynthesis' in window) { refresh(); speechSynthesis.onvoiceschanged = refresh; }

export const available = () => 'speechSynthesis' in window;
export const norwegianVoices = () => { refresh(); return voices; };

export function speak(text) {
  if (!available() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const s = settings();
  const v = voices.find(v => v.voiceURI === s.voiceURI) || voices.find(v => /nb/i.test(v.lang)) || voices[0];
  if (v) u.voice = v;
  u.lang = v?.lang || 'nb-NO';
  u.rate = s.rate || 0.9;
  speechSynthesis.speak(u);
}
