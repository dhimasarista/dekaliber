import { defineEventHandler } from 'h3';

// §5.4 README: endpoint instan tanpa logic apa pun, dipakai untuk mengukur
// "generator ceiling" — batas RPS maksimum Analog sendiri sebelum trafik
// diarahkan ke backend NestJS/Spring Boot asli.
export default defineEventHandler(() => ({ ok: true }));
