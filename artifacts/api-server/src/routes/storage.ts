import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const sidecarEndpoint = "http://127.0.0.1:1106";
function privateObjectDir() {
  const value = process.env.PRIVATE_OBJECT_DIR;
  if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  return value.replace(/\/$/, "");
}

async function signObjectUrl(objectName: string, method: "PUT" | "GET") {
  const path = objectName.replace(/^\/+/, "");
  const bucketPath = `${privateObjectDir()}/${path}`;
  const [, bucketName, ...parts] = bucketPath.split("/");
  const response = await fetch(`${sidecarEndpoint}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: parts.join("/"),
      method,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Storage signing failed (${response.status})`);
  const data = await response.json() as { signed_url?: string };
  if (!data.signed_url) throw new Error("Storage signer returned no URL");
  return data.signed_url;
}

router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const body = req.body as { name?: unknown; size?: unknown; contentType?: unknown };
  if (
    typeof body.name !== "string" || body.name.length === 0
    || typeof body.size !== "number" || !Number.isInteger(body.size) || body.size <= 0
    || typeof body.contentType !== "string" || body.contentType.length === 0
  ) {
    res.status(400).json({ error: "name, size and contentType are required" });
    return;
  }
  try {
    const objectPath = `uploads/${randomUUID()}`;
    const uploadURL = await signObjectUrl(objectPath, "PUT");
    res.json({
      uploadURL,
      objectPath: `/objects/${objectPath}`,
      metadata: { name: body.name, size: body.size, contentType: body.contentType },
    });
  } catch (error) {
    req.log.error({ err: error }, "Unable to sign storage upload");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const rawPath = req.params.path;
    const objectName = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
    if (!objectName || objectName.includes("..")) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    const signedURL = await signObjectUrl(objectName, "GET");
    res.redirect(307, signedURL);
  } catch (error) {
    req.log.error({ err: error }, "Unable to serve storage object");
    res.status(404).json({ error: "Object not found" });
  }
});

export default router;