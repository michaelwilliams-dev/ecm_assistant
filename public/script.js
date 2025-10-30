// public/script.js — ECM Assistant
// ISO Timestamp: 🕒 2025-10-29T15:45:00Z
// ✅ Connects to ECM Assistant backend via same-origin /ask
// ✅ Sends all three email fields (user, manager, optional)
// ✅ Displays ECM report or clear error message

console.log("CLIENT JS VERSION = v2025-10-29T15:45:00Z (ECM Assistant)");

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const generateBtn = $("generate");
  const output = $("response");
  const emailInput = $("email");
  const managerInput = $("managerEmail");
  const clientInput = $("clientEmail");
  const clarificationInput = $("clarification") || $("topic") || $("question");
  const isoSpan = $("iso-timestamp");

  if (isoSpan) isoSpan.textContent = new Date().toISOString();

  if (!generateBtn) {
    console.error("❌ Missing #generate button");
    return;
  }

  generateBtn.addEventListener("click", async () => {
    const question = clarificationInput?.value?.trim() || "";
    const email = emailInput?.value?.trim() || "";
    const managerEmail = managerInput?.value?.trim() || "";
    const clientEmail = clientInput?.value?.trim() || "";

    if (!question) {
      output.textContent = "❌ Please enter a question or description.";
      return;
    }

    const payload = {
      question,
      email,
      managerEmail,
      clientEmail,
      ts: new Date().toISOString(),
    };

    console.log("📤 [CLIENT /ask] Sending payload", payload);
    output.textContent =
      "⏳ Semantic Search then generating ECM Assistant Report – please wait.";

    try {
      // ✅ same-origin endpoint
      const res = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        output.textContent = `❌ Server error: ${data?.error || res.status}`;
        console.error("❌ Backend error:", data);
        return;
      }

      // ======== BEGIN RESPONSE HANDLING ========
      if (data?.answer) {
        output.innerHTML = data.answer;
      } else if (data?.reportText) {
        output.innerHTML = data.reportText;
      } else {
        output.innerHTML =
          "⚠️ No report returned. Please check backend logs.";
        console.warn("⚠️ Unexpected response:", data);
      }
      // ======== END RESPONSE HANDLING ========

    } catch (err) {
      console.error("❌ Network or fetch error:", err);
      output.textContent =
        "❌ Failed to contact backend: " + (err.message || String(err));
    }
  });
});
