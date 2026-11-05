// Masked previews shown in the PII review UI. They must be enough for a
// reviewer to recognise which occurrence they are deciding on, without
// revealing the full value.

export function maskAadhaar(digits: string): string {
  return `XXXX XXXX ${digits.slice(-4)}`;
}

export function maskPhone(digits: string): string {
  return `XXXXXX${digits.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [local, domain = ""] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.charAt(0)}***@${host.charAt(0)}***${tld}`;
}

export function maskIpv4(ip: string): string {
  return `${ip.split(".")[0]}.XXX.XXX.XXX`;
}

export function maskAddress(text: string, pinCode?: string): string {
  const length = text.trim().length;
  return `[address-like text, ${length} chars${pinCode ? `, PIN ${pinCode.charAt(0)}XXXXX` : ""}]`;
}
