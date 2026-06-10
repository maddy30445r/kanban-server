import jwt from "jsonwebtoken";

export const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export type JwtPayload = {
  sub: string;      // userId
  name: string;     // display name
  color: string;    // hex color for awareness
};

// Dev-only user table. Plaintext passwords are fine for this portfolio piece —
// the project's focus is CRDT sync, not auth. Swap for bcrypt + a real users
// table when this graduates beyond a demo.
export const USERS: Record<string, { password: string; name: string; color: string }> = {
  maddy:  { password: "dev", name: "Maddy Mittal",  color: "#ef4444" },
  shivam: { password: "dev", name: "Shivam", color: "#3b82f6" },
  alice:  { password: "dev", name: "Alice",  color: "#10b981" },
  bob:    { password: "dev", name: "Bob",    color: "#f59e0b" },
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
