import { networkInterfaces } from "node:os";

export interface PrivateIpv4Address {
  address: string;
  interfaceName: string;
}

export function listPrivateIpv4Addresses(): PrivateIpv4Address[] {
  const addresses: PrivateIpv4Address[] = [];
  for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family !== "IPv4" || !isPrivateIpv4(entry.address)) continue;
      addresses.push({ address: entry.address, interfaceName });
    }
  }
  return addresses;
}

/** Node 的 IPv4 socket 常以 ::ffff:192.168.x.x 形式暴露。 */
export function normalizeRemoteAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

export function isPrivateOrLoopbackAddress(address: string | undefined): boolean {
  const normalized = normalizeRemoteAddress(address);
  if (!normalized) return false;
  if (normalized === "::1") return true;
  return isPrivateIpv4(normalized) || normalized.startsWith("127.");
}

export function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second] = parts as [number, number, number, number];
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first === 127
  );
}
