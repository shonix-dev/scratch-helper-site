const state = {
  project: null,
  analysis: null,
  fileName: "",
};

const fullwidthPattern = /[\uFF01-\uFF5E\u3000]/;
const numericMinusPattern = /ー(?=\d)/g;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

$("#fileInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const project = await loadSb3Data(file);
    state.project = project;
    state.fileName = file.name;
    state.analysis = analyzeProject(project);
    render();
  } catch (error) {
    alert(`読み込みに失敗しました: ${error.message}`);
  }
});

$("#audience").addEventListener("change", () => {
  if (state.analysis) renderTeacher();
});

$$(".copy-prompt-button").forEach((button) => {
  button.addEventListener("click", async () => {
    const text = $("#promptText").value;
    if (!text) return;

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      $("#promptText").select();
      document.execCommand("copy");
    }

    const originalText = button.textContent;
    button.textContent = "コピー済み";
    setTimeout(() => {
      button.textContent = originalText;
    }, 1200);
  });
});

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((item) => item.classList.remove("active"));
    $$(".tab-panel").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    $(`#${tab.dataset.tab}`).classList.add("active");
  });
});

async function loadSb3Data(file) {
  if (!window.JSZip) {
    throw new Error(
      "JSZipを読み込めませんでした。ネットワーク接続を確認してください。",
    );
  }

  const zip = await JSZip.loadAsync(file);
  const projectFile = zip.file("project.json");
  if (!projectFile) {
    throw new Error(
      "project.json が見つかりません。Scratchの .sb3 ファイルか確認してください。",
    );
  }

  return JSON.parse(await projectFile.async("string"));
}

function analyzeProject(projectData) {
  const unusedVariables = analyzeUnusedVariables(projectData);
  const unusedIds = new Set(unusedVariables.map((item) => item.id));
  const unusedNamesByOwner = new Map();

  unusedVariables.forEach((item) => {
    if (!unusedNamesByOwner.has(item.owner))
      unusedNamesByOwner.set(item.owner, []);
    unusedNamesByOwner.get(item.owner).push(item.name);
  });

  const rows = (projectData.targets || []).map((target) => {
    const name = target.name || "Unknown";
    const blocks = target.blocks || {};
    const unused = (unusedNamesByOwner.get(name) || []).sort();
    return {
      name,
      isStage: Boolean(target.isStage),
      blockCount: Object.keys(blocks).length,
      unusedVariables: unused,
    };
  });

  const totalBlocks = rows.reduce((sum, row) => sum + row.blockCount, 0);
  const stageCount = rows.filter((row) => row.isStage).length;
  const spriteUnusedCount = unusedVariables.filter(
    (item) => !item.isGlobal,
  ).length;
  const stageUnusedCount = unusedVariables.filter(
    (item) => item.isGlobal,
  ).length;
  const messages = analyzeUnusedMessages(projectData);
  const fullwidthIssues = findFullwidthIssues(projectData);
  const summary = buildProjectSummary(projectData, unusedIds, messages);

  return {
    rows,
    totalBlocks,
    stageCount,
    spriteUnusedCount,
    stageUnusedCount,
    unusedVariables,
    messages,
    fullwidthIssues,
    summary,
  };
}

function collectDefinedVariables(projectData) {
  const variables = new Map();
  (projectData.targets || []).forEach((target) => {
    const owner = target.name || "Unknown";
    const isGlobal = Boolean(target.isStage);
    Object.entries(target.variables || {}).forEach(([id, info]) => {
      if (Array.isArray(info) && info.length >= 1) {
        variables.set(String(id), {
          id: String(id),
          name: String(info[0]),
          owner,
          isGlobal,
        });
      }
    });
  });
  return variables;
}

function collectVariableUsage(projectData) {
  const usage = new Map();
  const writeOpcodes = new Set(["data_setvariableto", "data_changevariableby"]);
  const readOpcodes = new Set(["data_variable"]);

  const ensure = (id) => {
    if (!usage.has(id)) {
      usage.set(id, {
        readCount: 0,
        writeCount: 0,
        otherCount: 0,
        usedBy: new Set(),
      });
    }
    return usage.get(id);
  };

  (projectData.targets || []).forEach((target) => {
    const spriteName = target.name || "Unknown";
    Object.values(target.blocks || {}).forEach((block) => {
      if (!block || typeof block !== "object") return;
      const variableField = block.fields?.VARIABLE;
      if (!Array.isArray(variableField) || variableField.length < 2) return;

      const varId = String(variableField[1]);
      const item = ensure(varId);
      item.usedBy.add(spriteName);

      if (writeOpcodes.has(block.opcode)) item.writeCount += 1;
      else if (readOpcodes.has(block.opcode)) item.readCount += 1;
      else item.otherCount += 1;
    });
  });

  return usage;
}

function analyzeUnusedVariables(projectData) {
  const defined = collectDefinedVariables(projectData);
  const usage = collectVariableUsage(projectData);
  const diagnostics = [];

  defined.forEach((meta, id) => {
    const stat = usage.get(id) || {
      readCount: 0,
      writeCount: 0,
      otherCount: 0,
      usedBy: new Set(),
    };

    let label = "";
    let severity = "";
    let reason = "";
    let suggestion = "";

    if (
      stat.readCount === 0 &&
      stat.writeCount === 0 &&
      stat.otherCount === 0
    ) {
      label = "完全未使用";
      severity = "high";
      reason =
        "この変数は作られていますが、どのブロックからも参照されていません。";
      suggestion =
        "使わないなら削除し、使うなら表示や条件分岐などの処理につないでください。";
    } else if (stat.readCount === 0 && stat.writeCount > 0) {
      label = "書き込みのみ";
      severity = "medium";
      reason =
        "この変数には値が入っていますが、その値を読むブロックが見つかりませんでした。";
      suggestion =
        "表示、判定、計算などのブロックでこの変数を読む処理を追加してください。";
    } else {
      return;
    }

    diagnostics.push({
      ...meta,
      label,
      severity,
      reason,
      suggestion,
      readCount: stat.readCount,
      writeCount: stat.writeCount,
      otherCount: stat.otherCount,
      usedBy: Array.from(stat.usedBy).sort(),
    });
  });

  const severityOrder = { high: 0, medium: 1, low: 2 };
  return diagnostics.sort((a, b) => {
    const sev = severityOrder[a.severity] - severityOrder[b.severity];
    if (sev !== 0) return sev;
    return `${a.owner}${a.name}`.localeCompare(`${b.owner}${b.name}`, "ja");
  });
}

function analyzeUnusedMessages(projectData) {
  const sentById = new Map();
  const receivedById = new Map();
  const idToName = new Map();

  (projectData.targets || []).forEach((target) => {
    if (target.isStage) {
      Object.entries(target.broadcasts || {}).forEach(([id, name]) => {
        idToName.set(String(id), String(name));
      });
    }
  });

  const add = (map, id, sprite) => {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(sprite);
  };

  const extractBroadcast = (block, blocks) => {
    if (!block || typeof block !== "object") return null;
    const option = block.fields?.BROADCAST_OPTION;
    if (Array.isArray(option) && option.length >= 1) {
      const name = String(option[0]).trim();
      const id =
        option.length >= 2 && option[1] ? String(option[1]).trim() : name;
      return { id, name: idToName.get(id) || name };
    }

    const input = block.inputs?.BROADCAST_INPUT;
    if (Array.isArray(input) && input.length >= 2) {
      const value = input[1];
      if (Array.isArray(value) && value.length >= 3) {
        const name = String(value[1]).trim();
        const id = value[2] ? String(value[2]).trim() : name;
        return { id, name: idToName.get(id) || name };
      }
      if (typeof value === "string" && blocks[value]) {
        return extractBroadcast(blocks[value], blocks);
      }
    }
    return null;
  };

  (projectData.targets || []).forEach((target) => {
    const spriteName = target.name || "Unknown";
    const blocks = target.blocks || {};
    Object.values(blocks).forEach((block) => {
      if (!block || typeof block !== "object") return;
      const extracted = extractBroadcast(block, blocks);
      if (!extracted) return;

      if (
        block.opcode === "event_broadcast" ||
        block.opcode === "event_broadcastandwait"
      ) {
        add(sentById, extracted.id, spriteName);
      } else if (block.opcode === "event_whenbroadcastreceived") {
        add(receivedById, extracted.id, spriteName);
      }
    });
  });

  return {
    sentOnly: toDisplayMap(sentById, receivedById, idToName),
    receivedOnly: toDisplayMap(receivedById, sentById, idToName),
  };
}

function toDisplayMap(source, opposite, idToName) {
  const output = {};
  const used = new Set();
  source.forEach((sprites, id) => {
    if (opposite.has(id)) return;
    const name = idToName.get(id) || id;
    const key = used.has(name) ? `${name} [${id}]` : name;
    used.add(key);
    output[key] = Array.from(sprites).sort();
  });
  return output;
}

function findFullwidthIssues(projectData) {
  const issues = [];
  const seen = new Set();

  const addIssue = (category, spriteName, text) => {
    if (typeof text !== "string") return;
    if (!hasFullwidthIssue(text)) return;

    const key = `${category}\u0000${spriteName}\u0000${text}`;
    if (seen.has(key)) return;
    seen.add(key);

    issues.push({
      category,
      sprite: spriteName,
      value: text,
      candidate: toHalfwidthCandidate(text),
    });
  };

  (projectData.targets || []).forEach((target) => {
    const spriteName = target.name || "Unknown";
    const label = target.isStage ? "Stage" : spriteName;
    addIssue("スプライト名", label, spriteName);

    Object.values(target.variables || {}).forEach((info) => {
      if (Array.isArray(info) && info.length >= 1)
        addIssue("変数名", label, String(info[0]));
    });
    Object.values(target.lists || {}).forEach((info) => {
      if (Array.isArray(info) && info.length >= 1)
        addIssue("リスト名", label, String(info[0]));
    });
    Object.values(target.broadcasts || {}).forEach((name) => {
      addIssue("メッセージ名", label, String(name));
    });

    Object.values(target.blocks || {}).forEach((block) => {
      if (!block || typeof block !== "object") return;
      Object.values(block.fields || {}).forEach((fieldValue) => {
        if (Array.isArray(fieldValue) && fieldValue.length)
          addIssue("ブロック内テキスト", label, String(fieldValue[0]));
        else addIssue("ブロック内テキスト", label, String(fieldValue));
      });
      Object.values(block.inputs || {}).forEach((inputValue) => {
        iterStrings(inputValue).forEach((text) =>
          addIssue("入力値テキスト", label, text),
        );
      });
    });
  });

  return issues;
}

function iterStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(iterStrings);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(iterStrings);
  return [];
}

function hasFullwidthIssue(text) {
  return fullwidthPattern.test(text) || /ー(?=\d)/.test(text);
}

function toHalfwidthCandidate(text) {
  return text.normalize("NFKC").replace(numericMinusPattern, "-");
}

function buildProjectSummary(projectData, unusedIds, messages) {
  const sprites = (projectData.targets || []).filter(
    (target) => !target.isStage,
  );
  const opcodeCounter = new Map();
  const spriteBlockCounts = [];
  const zeroBlockSprites = [];

  sprites.forEach((target) => {
    const name = target.name || "Unknown";
    const blocks = target.blocks || {};
    const count = Object.keys(blocks).length;
    spriteBlockCounts.push([name, count]);
    if (count === 0) zeroBlockSprites.push(name);
    Object.values(blocks).forEach((block) => {
      if (block?.opcode)
        opcodeCounter.set(
          block.opcode,
          (opcodeCounter.get(block.opcode) || 0) + 1,
        );
    });
  });

  const totalBlocks = spriteBlockCounts.reduce(
    (sum, [, count]) => sum + count,
    0,
  );
  const topSprites = [...spriteBlockCounts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const opcodeTop10 = [...opcodeCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    spriteCount: sprites.length,
    totalBlocks,
    topSprites,
    zeroBlockSprites,
    unusedVarCount: unusedIds.size,
    messageSentOnly: messages.sentOnly,
    messageReceivedOnly: messages.receivedOnly,
    opcodeTop10,
  };
}

function summaryToText(summary) {
  const lines = [
    `スプライト数: ${summary.spriteCount}`,
    `総ブロック数: ${summary.totalBlocks}`,
  ];

  if (summary.topSprites.length) {
    lines.push(
      `ブロック数が多いスプライト上位: ${summary.topSprites.map(([name, count]) => `${name}(${count})`).join(", ")}`,
    );
  }
  if (summary.zeroBlockSprites.length) {
    lines.push(
      `ブロックが0のスプライト: ${summary.zeroBlockSprites.join(", ")}`,
    );
  }
  lines.push(`未使用変数総数: ${summary.unusedVarCount}`);

  if (Object.keys(summary.messageSentOnly).length) {
    lines.push(
      `送信だけで受信がないメッセージ: ${Object.keys(summary.messageSentOnly).join(", ")}`,
    );
  }
  if (Object.keys(summary.messageReceivedOnly).length) {
    lines.push(
      `受信だけで送信がないメッセージ: ${Object.keys(summary.messageReceivedOnly).join(", ")}`,
    );
  }
  if (summary.opcodeTop10.length) {
    lines.push(
      `よく使われているブロック(opcode)上位: ${summary.opcodeTop10.map(([op, count]) => `${op}(${count})`).join(", ")}`,
    );
  }

  return lines.join("\n");
}

function render() {
  $("#emptyState").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $("#fileName").textContent = state.fileName;
  renderOverview();
  renderChecks();
  renderTeacher();
}

function renderOverview() {
  const analysis = state.analysis;
  const maxRow = [...analysis.rows].sort(
    (a, b) => b.blockCount - a.blockCount,
  )[0] || { name: "-", blockCount: 0 };

  $("#metrics").innerHTML = [
    metric("ステージ総数", analysis.stageCount),
    metric("総ブロック数", analysis.totalBlocks),
    metric("最大ブロック数", maxRow.blockCount, maxRow.name),
    metric("ステージ未使用変数", analysis.stageUnusedCount),
    metric("スプライト未使用変数", analysis.spriteUnusedCount),
  ].join("");

  const sortedRows = [...analysis.rows].sort(
    (a, b) => b.blockCount - a.blockCount,
  );
  const maxBlocks = Math.max(...sortedRows.map((row) => row.blockCount), 1);

  $("#blockBars").innerHTML = sortedRows
    .map((row) => {
      const width = Math.round((row.blockCount / maxBlocks) * 100);
      return `
        <div class="bar-row">
          <strong>${escapeHtml(row.name)}</strong>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <span>${row.blockCount}</span>
        </div>
      `;
    })
    .join("");

  $("#spriteTable").innerHTML = sortedRows
    .map((row) => {
      const ratio = analysis.totalBlocks
        ? ((row.blockCount / analysis.totalBlocks) * 100).toFixed(1)
        : "0.0";
      return `
        <tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${row.blockCount}</td>
          <td>${ratio}%</td>
          <td>${row.unusedVariables.length ? escapeHtml(row.unusedVariables.join(", ")) : "なし"}</td>
        </tr>
      `;
    })
    .join("");
}

function renderChecks() {
  const { messages, fullwidthIssues, unusedVariables } = state.analysis;
  renderMessageChecks(messages);
  renderFullwidthChecks(fullwidthIssues);
  renderVariableChecks(unusedVariables);
}

function renderMessageChecks(messages) {
  const sentOnly = Object.entries(messages.sentOnly);
  const receivedOnly = Object.entries(messages.receivedOnly);
  if (!sentOnly.length && !receivedOnly.length) {
    $("#messageChecks").innerHTML =
      `<p class="status ok">送受信の不一致は見つかりませんでした。</p>`;
    return;
  }

  $("#messageChecks").innerHTML = [
    sentOnly.length
      ? `<p class="status error">受信されていないメッセージ ${sentOnly.length}件</p>${issueList(sentOnly, "送信スプライト")}`
      : `<p class="status ok">送信のみのメッセージはありません。</p>`,
    receivedOnly.length
      ? `<p class="status warn">送信されていないメッセージ ${receivedOnly.length}件</p>${issueList(receivedOnly, "待機スプライト")}`
      : `<p class="status ok">受信のみのメッセージはありません。</p>`,
  ].join("");
}

function renderFullwidthChecks(issues) {
  if (!issues.length) {
    $("#fullwidthChecks").innerHTML =
      `<p class="status ok">全角英数字・全角記号は検出されませんでした。</p>`;
    return;
  }

  $("#fullwidthChecks").innerHTML = `
    <p class="status error">全角英数字・全角記号を ${issues.length} 件検出しました。</p>
    <div class="card-list">
      ${issues
        .slice(0, 12)
        .map(
          (item) => `
        <div class="issue-card">
          <h4>${escapeHtml(item.category)} / ${escapeHtml(item.sprite)}</h4>
          <p>値: ${escapeHtml(item.value)}</p>
          <p>変換候補: ${escapeHtml(item.candidate)}</p>
        </div>
      `,
        )
        .join("")}
    </div>
    ${issues.length > 12 ? `<p class="muted">ほか ${issues.length - 12} 件あります。</p>` : ""}
  `;
}

function renderVariableChecks(items) {
  if (!items.length) {
    $("#variableChecks").innerHTML =
      `<p class="status ok">未使用変数は見つかりませんでした。</p>`;
    return;
  }

  $("#variableChecks").innerHTML = items
    .map(
      (item) => `
      <div class="issue-card">
        <h4>${escapeHtml(item.name)}</h4>
        <p><strong>${item.label}</strong> / 定義場所: ${escapeHtml(item.isGlobal ? "Stage" : item.owner)}</p>
        <p>${escapeHtml(item.reason)}</p>
        <p>改善案: ${escapeHtml(item.suggestion)}</p>
        <p class="muted">読み取り ${item.readCount} 回 / 書き込み ${item.writeCount} 回 / その他 ${item.otherCount} 回</p>
      </div>
    `,
    )
    .join("");
}

function renderTeacher() {
  const summaryText = summaryToText(state.analysis.summary);
  const audience = $("#audience").value;
  const prompt = `以下はScratch作品の静的解析結果です。この解析結果の情報に基づいて、作成者の子ども（${audience}）に向けたアドバイスを作成してください。
解析結果の情報は絶対に捏造しないでください。真実をそのまま伝えてください。
変数"my variable"に関する言及はしなくて大丈夫です。

---解析データ---
${summaryText}
---ここまで---

## ガイドライン
1. **ほめる**: まずは頑張った点や統計から見える良い傾向（例：たくさんブロックを使った、色々な機能を試した等）を2~3つ具体的に褒めてください。
2. **見どころを伝える**: 作った作品の見どころや素敵なポイントを2~3つ具体的に提示してください。
3. **改善のヒントとアレンジの提案**: コードを整理するためや、バグを防ぐためのヒント、ゲームとして付け加えると面白くなりそうなアレンジ案を、合計2~3つ提案してください。
    - 未使用変数や、送受信の不一致があれば、それを優しく指摘してください。
    - ターゲットは「${audience}」です。難しい専門用語は避け、この年齢層に伝わる言葉づかいで優しく語りかけてください。
      - 低学年なら：ひらがなを多めに、優しく。（徹底してほしい！）
      - 中学年なら：漢字は少し使いつつ、具体的な例え話を混ぜて。（徹底してほしい！）
      - 高学年・中学生なら：論理的な説明を加えつつ、プログラマとしての心得も少し混ぜて。（徹底してほしい！）
4. **まとめ**: 最後に「これからも楽しく作ってね！」というような応援メッセージで締めくくってください。
`;

  $("#summaryText").textContent = summaryText;
  $("#promptText").value = prompt;
}

function metric(label, value, detail = "") {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>${detail ? `<small class="muted">${escapeHtml(detail)}</small>` : ""}</div>`;
}

function issueList(entries, label) {
  return `<div class="card-list">${entries
    .map(
      ([message, sprites]) => `
    <div class="issue-card">
      <h4>${escapeHtml(message)}</h4>
      <p>${label}: ${escapeHtml(sprites.join(", "))}</p>
    </div>
  `,
    )
    .join("")}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
