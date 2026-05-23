const LICENSE_BINDING_TTL_SECONDS = 7 * 24 * 60 * 60;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return corsResponse(null, 204);
    }

    const url = new URL(request.url);
    const isVerifyRequest = url.pathname === "/verify";
    const isUnlinkRequest = url.pathname === "/unlink";
    if (request.method !== "POST" || (!isVerifyRequest && !isUnlinkRequest)) {
      return corsResponse({ active: false, message: "Not found" }, 404);
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      return corsResponse({ active: false, message: "Invalid JSON" }, 400);
    }

    if (!env.LICENSE_BINDINGS) {
      return corsResponse({
        active: false,
        message: "Worker chua cau hinh KV binding LICENSE_BINDINGS."
      }, 500);
    }

    const licenseKey = String(body.licenseKey || "").trim();
    const deviceId = String(body.deviceId || "").trim();
    const licenses = readLicenses(env);
    const license = licenses[licenseKey];

    if (!deviceId) {
      return corsResponse({
        active: false,
        message: "Khong xac dinh duoc may dang kich hoat."
      }, 200);
    }

    if (!license) {
      return corsResponse({ active: false, message: "License khong ton tai." }, 200);
    }

    if (!license.active) {
      return corsResponse({ active: false, message: "License da bi thu hoi." }, 200);
    }

    const now = new Date();
    const nowMs = now.getTime();
    const expiresAt = new Date(nowMs + LICENSE_BINDING_TTL_SECONDS * 1000).toISOString();
    const bindingKey = `license:${licenseKey}`;
    const currentBinding = await env.LICENSE_BINDINGS.get(bindingKey, "json");
    const bindingExpired = isBindingExpired(currentBinding, nowMs);

    if (isUnlinkRequest) {
      if (!currentBinding?.deviceId || bindingExpired) {
        if (currentBinding?.deviceId) {
          await env.LICENSE_BINDINGS.delete(bindingKey);
        }

        return corsResponse({
          active: false,
          unlinked: true,
          message: "License nay chua lien ket voi may nao hoac lien ket cu da het han."
        }, 200);
      }

      if (currentBinding.deviceId !== deviceId) {
        return corsResponse({
          active: false,
          unlinked: false,
          message: "Chi may dang kich hoat license nay moi duoc huy lien ket."
        }, 200);
      }

      await env.LICENSE_BINDINGS.delete(bindingKey);
      return corsResponse({
        active: false,
        unlinked: true,
        message: "Da huy lien ket license. Ban co the kich hoat tren may khac."
      }, 200);
    }

    if (currentBinding?.deviceId && currentBinding.deviceId !== deviceId && !bindingExpired) {
      return corsResponse({
        active: false,
        message: `License nay da duoc kich hoat tren may khac. Neu may cu da go tien ich, key se tu mo lai sau ${Math.ceil(LICENSE_BINDING_TTL_SECONDS / 86400)} ngay khong hoat dong.`
      }, 200);
    }

    const binding = {
      deviceId,
      licenseKey,
      name: license.name,
      extensionId: String(body.extensionId || ""),
      version: String(body.version || ""),
      boundAt: currentBinding?.deviceId === deviceId && currentBinding?.boundAt
        ? currentBinding.boundAt
        : now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt
    };

    await env.LICENSE_BINDINGS.put(bindingKey, JSON.stringify(binding), {
      expirationTtl: LICENSE_BINDING_TTL_SECONDS
    });

    return corsResponse({
      active: true,
      message: "License hop le.",
      name: license.name,
      deviceLocked: true,
      expiresAt
    }, 200);
  }
};

function isBindingExpired(binding, nowMs) {
  if (!binding?.deviceId) return true;

  const explicitExpiresMs = Date.parse(binding.expiresAt || "");
  if (Number.isFinite(explicitExpiresMs)) {
    return explicitExpiresMs <= nowMs;
  }

  const lastSeenMs = Date.parse(binding.lastSeenAt || binding.boundAt || "");
  if (Number.isFinite(lastSeenMs)) {
    return lastSeenMs + LICENSE_BINDING_TTL_SECONDS * 1000 <= nowMs;
  }

  return false;
}

function readLicenses(env) {
  if (!env.LICENSES_JSON) return {};

  try {
    const parsed = JSON.parse(env.LICENSES_JSON);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function corsResponse(data, status = 200) {
  return new Response(data ? JSON.stringify(data) : null, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}
