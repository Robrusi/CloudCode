import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

const PREFIX = "cloudcode:v1:"

function encryptionKey() {
  const secret =
    process.env.CLOUDCODE_SECRET_ENCRYPTION_KEY ?? process.env.CLERK_SECRET_KEY

  if (!secret) {
    throw new Error(
      "Set CLOUDCODE_SECRET_ENCRYPTION_KEY or CLERK_SECRET_KEY before saving preset secrets."
    )
  }

  return createHash("sha256").update(secret).digest()
}

export function isEncryptedSecret(value: string) {
  return value.startsWith(PREFIX)
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [
    PREFIX,
    iv.toString("base64url"),
    ".",
    tag.toString("base64url"),
    ".",
    ciphertext.toString("base64url"),
  ].join("")
}

export function decryptSecret(value: string) {
  if (!isEncryptedSecret(value)) return value

  const [ivBase64, tagBase64, ciphertextBase64] = value
    .slice(PREFIX.length)
    .split(".")

  if (!ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error("Stored preset secret is malformed.")
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivBase64, "base64url")
  )
  decipher.setAuthTag(Buffer.from(tagBase64, "base64url"))

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}
