/** Maps domain status strings to the badge color system (teal = active/primary, green = success, amber = pending/warning, red = destructive/failed, gray = neutral/archived). */
function toneFor(value: string): "navy" | "teal" | "green" | "amber" | "red" | "gray" {
  const v = value.toLowerCase();
  if (["approved", "verified", "active", "success", "completed", "allow", "in custody"].includes(v)) return "green";
  if (["pending", "under review", "warning", "requires review", "monitoring active", "transferred"].includes(v)) return "amber";
  if (["rejected", "revoked", "expired", "denied", "failure", "violation", "restricted"].includes(v)) return "red";
  if (["under investigation", "filed", "in progress", "pending hearing"].includes(v)) return "teal";
  if (["closed", "archived", "released", "superseded"].includes(v)) return "gray";
  return "navy";
}

export function badge(text: string, toneOverride?: "navy" | "teal" | "green" | "amber" | "red" | "gray"): string {
  const tone = toneOverride || toneFor(text);
  return `<span class="badge badge-${tone}">${text}</span>`;
}

export function priorityBadge(priority: string): string {
  const tone = priority === "High" ? "red" : priority === "Medium" ? "amber" : "gray";
  return `<span class="badge badge-${tone}">${priority}</span>`;
}
