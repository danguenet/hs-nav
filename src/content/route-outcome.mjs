import { classifyDestination, sanitizeDiagnosticValue } from "../shared/routes.mjs";

export async function showRouteOutcome({
  ensureRoot,
  sendMessage,
  now = () => Date.now(),
  wait = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); })
}) {
  const response = await sendMessage({ action: "consume-route-attempt" });
  if (response?.ok === false) throw new Error(response.error || "Could not read route diagnostics.");
  const attempt = response?.attempt;
  if (!attempt || now() - attempt.requestedAt > 30_000) return;
  await wait(1200);
  const outcome = classifyDestination(location.href);
  if (outcome === "ok") return;

  const notice = document.createElement("aside");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  const message = document.createElement("div");
  message.textContent = outcome === "unavailable"
    ? `${attempt.keyword} appears unavailable for this HubSpot account. The saved product route was not replaced with the upsell page.`
    : outcome === "account"
      ? `Choose a HubSpot account to continue to ${attempt.keyword}.`
      : `${attempt.keyword} may have moved. You can copy diagnostics or report the route.`;
  const actions = document.createElement("div");
  actions.className = "notice-actions";
  const dismiss = document.createElement("button");
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => notice.remove());
  const routeLabel = attempt.source === "custom" ? "Custom destination" : attempt.keyword;
  const diagnostics = `HS Nav route: ${routeLabel}\nSaved path: ${sanitizeDiagnosticValue(attempt.path)}\nRequested: ${sanitizeDiagnosticValue(attempt.destination)}\nLanded: ${sanitizeDiagnosticValue(location.href)}\nOutcome: ${outcome}`;
  const copy = document.createElement("button");
  copy.textContent = "Copy diagnostics";
  copy.addEventListener("click", async () => {
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(diagnostics);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Copy failed";
      copy.disabled = false;
    }
  });
  actions.append(dismiss, copy);
  if (attempt.source !== "custom") {
    const report = document.createElement("a");
    report.textContent = "Report route";
    report.target = "_blank";
    report.rel = "noreferrer";
    report.href = `https://github.com/danguenet/hs-nav/issues/new?template=route-report.md&title=${encodeURIComponent(`Route: ${attempt.keyword}`)}&body=${encodeURIComponent(diagnostics)}`;
    actions.append(report);
  }
  notice.append(message, actions);
  ensureRoot().append(notice);
}
