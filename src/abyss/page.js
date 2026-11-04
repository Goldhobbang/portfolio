import { CONFIG } from './config.js';
const root = document.documentElement;
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
document.getElementById('year').textContent = new Date().getFullYear();
if (!RM && 'IntersectionObserver' in window) {
  const targets = $$('.section-top,.stack-intro,.stack-row,.case,.archive-list li,.pg-intro,.hud,.about,.signal,.footer');
  targets.forEach((n, i) => {
    if (!n.matches('.case,.signal,.about,.section-top')) n.classList.add('reveal');
    if (n.matches('.stack-row,.archive-list li')) n.style.setProperty('--d', (i % 4) * 85 + 'ms');
  });
  root.classList.add('motion-on');
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -9% 0px', threshold: .06 });
  targets.forEach(n => io.observe(n));
}
const navLinks = $$('.links a[href^="#"]');
const segs = ['stack', 'selected', 'playground', 'archive', 'about'].map(id => document.getElementById(id));
let pending = false;
function onScroll() {
  pending = false;
  root.style.setProperty('--hero-drift', !RM && innerWidth > 660 ? clamp(scrollY * .09, 0, 86) + 'px' : '0px');
  let active = null;
  segs.forEach(s => { if (s.getBoundingClientRect().top < innerHeight * .45) active = s.id; });
  navLinks.forEach(a => a.getAttribute('href') === '#' + active ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current'));
}
function requestScroll() { if (!pending) { pending = true; requestAnimationFrame(onScroll); } }
addEventListener('scroll', requestScroll, { passive: true });
addEventListener('resize', requestScroll, { passive: true });
onScroll();

for (const label of document.querySelectorAll('[data-lamp-key]')) label.textContent = CONFIG.interaction.lampKey.replace(/^(Key|Digit)/, '');
