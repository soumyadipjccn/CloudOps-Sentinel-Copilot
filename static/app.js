/**
 * CloudOps Sentinel Copilot - Industry Grade Self-RAG Frontend
 * Full state handling, streaming-feel rendering, citations, and file ingestion.
 */

document.addEventListener("DOMContentLoaded", () => {
  // Session ID Management
  let threadId = localStorage.getItem("sentinel_thread_id");
  if (!threadId) {
    threadId = "incident-" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem("sentinel_thread_id", threadId);
  }

  const sessionIdEl = document.getElementById("session-id-display");
  if (sessionIdEl) {
    sessionIdEl.textContent = `Thread: ${threadId.substring(0, 16)}...`;
  }

  // DOM Elements
  const chatViewport = document.getElementById("chat-viewport");
  const welcomeHero = document.getElementById("welcome-hero");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const btnSend = document.getElementById("btn-send");
  const btnNewChat = document.getElementById("btn-new-chat");
  const btnExport = document.getElementById("btn-export-chat");

  // Ingestion DOM
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const uploadStatus = document.getElementById("upload-status");

  // Audit Modal DOM
  const btnOpenAudit = document.getElementById("btn-open-audit");
  const btnCloseAudit = document.getElementById("btn-close-audit");
  const auditModalOverlay = document.getElementById("audit-modal-overlay");
  const auditTableBody = document.getElementById("audit-table-body");

  // Marked Markdown parser configuration
  if (window.marked) {
    marked.setOptions({
      highlight: function (code, lang) {
        if (window.hljs && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return window.hljs ? hljs.highlightAuto(code).value : code;
      },
      breaks: true,
      gfm: true,
    });
  }

  // Auto-resize chat textarea
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + "px";
  });

  // Handle keyboard shortcuts (Enter to send, Shift+Enter for newline)
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event("submit"));
    }
  });

  // Sample prompt card click handler
  document.querySelectorAll(".sample-prompt-card").forEach((card) => {
    card.addEventListener("click", () => {
      const prompt = card.getAttribute("data-prompt");
      if (prompt) {
        chatInput.value = prompt;
        chatInput.dispatchEvent(new Event("input"));
        chatForm.dispatchEvent(new Event("submit"));
      }
    });
  });

  // New Chat Session Button
  btnNewChat.addEventListener("click", () => {
    threadId = "incident-" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem("sentinel_thread_id", threadId);
    if (sessionIdEl) {
      sessionIdEl.textContent = `Thread: ${threadId.substring(0, 16)}...`;
    }
    chatViewport.innerHTML = "";
    if (welcomeHero) {
      chatViewport.appendChild(welcomeHero);
    }
    chatInput.value = "";
    chatInput.focus();
  });

  // Export Transcript Button
  btnExport.addEventListener("click", () => {
    const messages = [];
    document.querySelectorAll(".message-row").forEach((row) => {
      const isUser = row.classList.contains("user");
      const text = row.querySelector(".message-bubble")?.innerText || "";
      messages.push(`${isUser ? "OPERATOR" : "SENTINEL COPILOT"}:\n${text}\n`);
    });
    if (messages.length === 0) {
      alert("No conversation history to export yet.");
      return;
    }
    const blob = new Blob([messages.join("\n" + "=".repeat(60) + "\n\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `incident-transcript-${threadId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // =========================================================================
  // Knowledge Base Ingestion Handlers (Drag & Drop + File Picker)
  // =========================================================================
  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      handleFileUpload(fileInput.files[0]);
    }
  });

  async function handleFileUpload(file) {
    uploadStatus.className = "upload-status loading";
    uploadStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Ingesting & embedding: ${file.name}...`;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const resp = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.detail || "Failed to upload file");
      }

      uploadStatus.className = "upload-status success";
      uploadStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> Ingested: ${data.filename} (${data.chunks_indexed} vectors)`;
      setTimeout(() => {
        uploadStatus.style.display = "none";
      }, 7000);
    } catch (err) {
      uploadStatus.className = "upload-status error";
      uploadStatus.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${err.message}`;
    } finally {
      fileInput.value = "";
    }
  }

  // =========================================================================
  // Chat Dispatch and Response Rendering
  // =========================================================================
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = chatInput.value.trim();
    if (!query) return;

    if (welcomeHero && welcomeHero.parentNode === chatViewport) {
      chatViewport.removeChild(welcomeHero);
    }

    // Append User Message
    appendUserMessage(query);
    chatInput.value = "";
    chatInput.style.height = "auto";
    btnSend.disabled = true;

    // Append Bot Thinking Indicator
    const thinkingRow = appendThinkingIndicator();
    scrollToBottom();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query, thread_id: threadId }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: "Network error" }));
        throw new Error(errData.detail || "Error from Self-RAG service");
      }

      const ragResult = await response.json();
      thinkingRow.remove();
      appendBotResponse(ragResult);
    } catch (err) {
      thinkingRow.remove();
      appendErrorMessage(err.message);
    } finally {
      btnSend.disabled = false;
      scrollToBottom();
      chatInput.focus();
    }
  });

  function appendUserMessage(text) {
    const row = document.createElement("div");
    row.className = "message-row user";
    row.innerHTML = `
      <div class="avatar"><i class="fa-solid fa-user"></i></div>
      <div class="message-bubble">${escapeHtml(text)}</div>
    `;
    chatViewport.appendChild(row);
  }

  function appendThinkingIndicator() {
    const row = document.createElement("div");
    row.className = "message-row bot thinking-row";
    row.innerHTML = `
      <div class="avatar"><i class="fa-solid fa-brain"></i></div>
      <div class="message-bubble">
        <div class="thinking-bubble">
          <div class="dot-wave"></div>
          <div class="dot-wave"></div>
          <div class="dot-wave"></div>
          <span style="font-size: 12px; color: var(--accent-cyan); font-family: var(--font-mono); margin-left: 8px;">
            Retrieving & Verifying Evidence...
          </span>
        </div>
      </div>
    `;
    chatViewport.appendChild(row);
    return row;
  }

  function appendBotResponse(data) {
    const row = document.createElement("div");
    row.className = "message-row bot";

    // 1. Meta Badges (Route & Hallucination Support Status)
    let routeBadgeClass = data.used_web_search ? "route-web" : "route-internal";
    let supportBadgeClass =
      data.support_status === "fully_supported"
        ? "support-full"
        : data.support_status === "partially_supported"
        ? "support-partial"
        : "support-none";

    let supportText =
      data.support_status === "fully_supported"
        ? "Fully Supported"
        : data.support_status === "partially_supported"
        ? "Partially Supported"
        : "Hallucination Check: Review";

    // 2. Format Answer with Markdown
    const formattedHtml = window.marked ? marked.parse(data.answer) : escapeHtml(data.answer);

    // 3. Citations / Sources HTML
    let sourcesHtml = "";
    if (data.sources && data.sources.length > 0) {
      const pills = data.sources
        .map((s) => {
          if (s.type === "web") {
            return `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="source-pill">
              <i class="fa-solid fa-globe"></i> ${escapeHtml(s.title || s.url)}
            </a>`;
          } else {
            const pageStr = s.page ? ` (p. ${s.page})` : "";
            return `<span class="source-pill">
              <i class="fa-solid fa-file-lines"></i> ${escapeHtml(s.title || s.source)}${pageStr}
            </span>`;
          }
        })
        .join("");

      sourcesHtml = `
        <div class="sources-drawer">
          <div class="sources-header"><i class="fa-solid fa-quote-left"></i> Verified Sources</div>
          <div class="sources-pills">${pills}</div>
        </div>
      `;
    }

    // 4. Verification Trace Accordion
    let traceHtml = "";
    if (data.trace && data.trace.length > 0) {
      const traceItems = data.trace
        .map((t) => `<div class="trace-item">${escapeHtml(t)}</div>`)
        .join("");

      traceHtml = `
        <div class="trace-accordion">
          <button class="trace-toggle" type="button">
            <i class="fa-solid fa-chevron-right"></i> Trace Self-RAG Reasoning (${data.trace.length} steps)
          </button>
          <div class="trace-list" style="display: none;">
            ${traceItems}
          </div>
        </div>
      `;
    }

    row.innerHTML = `
      <div class="avatar"><i class="fa-solid fa-shield-halved"></i></div>
      <div class="message-bubble">
        <div class="rag-meta-header">
          <span class="rag-badge ${routeBadgeClass}">
            <i class="fa-solid fa-compass"></i> ${escapeHtml(data.route || "RAG Pipeline")}
          </span>
          <span class="rag-badge ${supportBadgeClass}">
            <i class="fa-solid fa-circle-check"></i> ${supportText}
          </span>
          ${
            data.usefulness
              ? `<span class="rag-badge" style="background: rgba(168, 85, 247, 0.15); color: var(--accent-purple); border: 1px solid rgba(168, 85, 247, 0.3);">
                  <i class="fa-solid fa-star"></i> Useful: ${escapeHtml(data.usefulness)}
                 </span>`
              : ""
          }
        </div>
        <div class="bot-content">${formattedHtml}</div>
        ${sourcesHtml}
        ${traceHtml}
      </div>
    `;

    chatViewport.appendChild(row);

    // Bind trace accordion toggle
    const traceBtn = row.querySelector(".trace-toggle");
    const traceList = row.querySelector(".trace-list");
    if (traceBtn && traceList) {
      traceBtn.addEventListener("click", () => {
        const isOpen = traceList.style.display === "block";
        traceList.style.display = isOpen ? "none" : "block";
        traceBtn.querySelector("i").className = isOpen
          ? "fa-solid fa-chevron-right"
          : "fa-solid fa-chevron-down";
      });
    }

    // Syntax highlight newly appended blocks
    if (window.hljs) {
      row.querySelectorAll("pre code").forEach((block) => {
        hljs.highlightElement(block);
      });
    }
  }

  function appendErrorMessage(errText) {
    const row = document.createElement("div");
    row.className = "message-row bot";
    row.innerHTML = `
      <div class="avatar" style="background: var(--accent-rose); color: white;"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <div class="message-bubble" style="border-color: rgba(244, 63, 94, 0.4); background: rgba(244, 63, 94, 0.08);">
        <strong style="color: var(--accent-rose);">Sentinel Pipeline Execution Error:</strong>
        <p style="margin-top: 6px; font-family: var(--font-mono); font-size: 13px;">${escapeHtml(errText)}</p>
      </div>
    `;
    chatViewport.appendChild(row);
  }

  function scrollToBottom() {
    chatViewport.scrollTop = chatViewport.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // =========================================================================
  // Audit Trail Dialog
  // =========================================================================
  btnOpenAudit.addEventListener("click", async () => {
    auditModalOverlay.classList.add("open");
    auditTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching verification audits...</td></tr>`;

    try {
      const res = await fetch("/api/audit?limit=20");
      const list = await res.json();
      if (!list || list.length === 0) {
        auditTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-dim); padding: 20px;">No audit queries logged yet.</td></tr>`;
        return;
      }

      auditTableBody.innerHTML = list
        .map((item) => {
          let time = item.created_at ? new Date(item.created_at).toLocaleTimeString() : "-";
          let traceArr = [];
          try {
            traceArr = JSON.parse(item.trace_json || "[]");
          } catch (_) {}

          return `
            <tr>
              <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-dim);">${time}</td>
              <td style="font-weight: 600; max-width: 250px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${escapeHtml(item.question)}">${escapeHtml(item.question)}</td>
              <td><span class="rag-badge route-internal">${escapeHtml(item.route || "RAG")}</span></td>
              <td><span class="rag-badge support-full">${escapeHtml(item.support_status || "Verified")}</span></td>
              <td>${item.used_web ? '<i class="fa-solid fa-check" style="color:var(--accent-emerald);"></i>' : '<i class="fa-solid fa-xmark" style="color:var(--text-dim);"></i>'}</td>
              <td style="font-family: var(--font-mono); font-size: 11px; color: var(--accent-cyan);">${traceArr.length} steps</td>
            </tr>
          `;
        })
        .join("");
    } catch (err) {
      auditTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--accent-rose); padding: 20px;">Error loading audits: ${err.message}</td></tr>`;
    }
  });

  btnCloseAudit.addEventListener("click", () => {
    auditModalOverlay.classList.remove("open");
  });

  auditModalOverlay.addEventListener("click", (e) => {
    if (e.target === auditModalOverlay) {
      auditModalOverlay.classList.remove("open");
    }
  });
});
