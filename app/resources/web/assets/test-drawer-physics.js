const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function drawerAnchors(height) {
  const middle = Math.round(Math.min(height * 0.43, height - 116));
  const anchors = [{ name: "expanded", y: 0 }];
  if (middle >= 52) anchors.push({ name: "partial", y: middle });
  anchors.push({ name: "closed", y: height + 48 });
  return anchors;
}

// Progressively resist motion outside the usable range without a hard stop.
export function rubberBand(y, anchors, height) {
  const limit = clamp(height * 0.21, 26, 70);
  const min = anchors[0].y;
  const max = anchors.at(-1).y;
  const resisted = delta => limit * (delta * 0.55) / (limit + delta * 0.55);
  if (y < min) return min - resisted(min - y);
  if (y > max) return max + resisted(y - max);
  return y;
}

// Use the last 100 ms of motion, including the release. A finger held still
// before lifting has little or no momentum even after a fast earlier move.
export function releaseVelocity(samples) {
  const end = samples.at(-1);
  if (!end) return 0;
  const start = samples.find(sample => end.t - sample.t <= 100) ?? end;
  const elapsed = end.t - start.t;
  return elapsed >= 8 ? clamp((end.y - start.y) / elapsed, -3.3, 3.3) : 0;
}

export function chooseAnchor(anchors, y, velocity) {
  const projected = y + clamp(velocity, -3.3, 3.3) * 200;
  return anchors.reduce((closest, anchor) =>
    Math.abs(anchor.y - projected) < Math.abs(closest.y - projected) ? anchor : closest);
}

// Analytic damped spring: the same trajectory at any refresh rate, with a
// small elastic overshoot. Positions are pixels and velocities are px/ms.
export function springPosition(from, to, velocity, elapsedMs) {
  const seconds = elapsedMs / 1000;
  const frequency = 24;
  const damping = 0.76;
  const decay = damping * frequency;
  const angular = frequency * Math.sqrt(1 - damping * damping);
  const distance = from - to;
  const sineWeight = (velocity * 1000 + decay * distance) / angular;
  return to + Math.exp(-decay * seconds) * (
    distance * Math.cos(angular * seconds) + sineWeight * Math.sin(angular * seconds)
  );
}
