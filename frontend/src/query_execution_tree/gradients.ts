// gradients.ts
//
// This module defines and animates SVG gradients used by D3 visualizations.
//
// # Purpose
//
// gradients.ts is responsible for creating reusable SVG definitions (<defs>)
// and driving two animated glow gradients that are applied elsewhere in the visualization:
//
// # Rotating radial-style gradient
// A linear gradient whose direction continuously rotates in a circular motion.
// It alternates opacity across multiple stops to create a soft, glowing effect.
//
// # Vertical flowing line gradient
// A vertical linear gradient with two bright bands that move from bottom to top.
// This creates the appearance of animated energy or flow along edges or links.
import * as d3 from 'd3';

export function animateGradients() {
  const defs = d3.select<SVGElement, any>('#queryExecutionTreeSvg').append('defs');
  const filter = defs.append('filter').attr('id', 'glow');
  filter.append('feGaussianBlur').attr('stdDeviation', 5).attr('result', 'coloredBlur');

  const feMerge = filter.append('feMerge');
  feMerge.append('feMergeNode').attr('in', 'coloredBlur');
  feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

  // Gradient
  const color = 'oklch(54.6% 0.245 262.881)';
  const rectGradient = defs.append('linearGradient').attr('id', 'glowGradientRect');
  rectGradient
    .append('stop')
    .attr('offset', '0%')
    .attr('stop-color', color)
    .attr('stop-opacity', 0.1);
  rectGradient
    .append('stop')
    .attr('offset', '30%')
    .attr('stop-color', color)
    .attr('stop-opacity', 0.4);
  rectGradient
    .append('stop')
    .attr('offset', '50%')
    .attr('stop-color', color)
    .attr('stop-opacity', 1);
  rectGradient
    .append('stop')
    .attr('offset', '70%')
    .attr('stop-color', color)
    .attr('stop-opacity', 0.4);
  rectGradient
    .append('stop')
    .attr('offset', '100%')
    .attr('stop-color', color)
    .attr('stop-opacity', 0.1);

  const linearGradient = defs
    .append('linearGradient')
    .attr('id', 'glowGradientLine')
    .attr('x1', '0%')
    .attr('y1', '100%')
    .attr('x2', '0%')
    .attr('y2', '0%');

  const linkGradiantStop1 = linearGradient
    .append('stop')
    .attr('stop-color', color)
    .attr('stop-opacity', 0);
  const linkGradiantStop2 = linearGradient
    .append('stop')
    .attr('stop-color', color)
    .attr('stop-opacity', 1);
  const linkGradiantStop3 = linearGradient
    .append('stop')
    .attr('stop-color', color)
    .attr('stop-opacity', 0);
  const linkGradiantStop4 = linearGradient
    .append('stop')
    .attr('stop-color', color)
    .attr('stop-opacity', 0);
  const linkGradiantStop5 = linearGradient
    .append('stop')
    .attr('stop-color', color)
    .attr('stop-opacity', 1);
  const linkGradiantStop6 = linearGradient
    .append('stop')
    .attr('stop-color', color)
    .attr('offset', '100%')
    .attr('stop-opacity', 0);

  const speed = 0.1;

  function updateGradientRect(t: number) {
    const angle = (t * speed) % 360;
    const rad = (angle * Math.PI) / 180;
    const x2 = 50 + 50 * Math.cos(rad);
    const y2 = 50 + 50 * Math.sin(rad);
    rectGradient
      .attr('x1', `${50 - 50 * Math.cos(rad)}%`)
      .attr('y1', `${50 - 50 * Math.sin(rad)}%`)
      .attr('x2', `${x2}%`)
      .attr('y2', `${y2}%`);
  }

  function updateGradientLine(t: number) {
    const p = (((t * speed * 10) / 18 + 50) % 100) - 50;

    const a = Math.min(Math.max(p - 10, 0), 100);
    const b = Math.min(Math.max(p, 0), 100);
    const c = Math.min(p + 10, 100);
    const d = Math.min(p + 100 - 10, 100);
    const e = Math.min(p + 100, 100);
    const f = Math.min(p + 100 + 10, 100);

    linkGradiantStop1.attr('offset', `${a}%`);
    linkGradiantStop2.attr('offset', `${b}%`);
    linkGradiantStop3.attr('offset', `${c}%`);
    linkGradiantStop4.attr('offset', `${d}%`);
    linkGradiantStop5.attr('offset', `${e}%`);
    linkGradiantStop6.attr('offset', `${f}%`);
  }

  d3.timer((elapsed) => {
    updateGradientRect(elapsed);
    updateGradientLine(elapsed);
  });
}
