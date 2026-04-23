function render(state) {
  $("#emptyState").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $("#fileName").textContent = state.fileName;
  renderOverview(state);
  renderChecks(state);
  renderTeacher(state);
}

function renderOverview(state) {
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

function renderChecks(state) {
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

function renderTeacher(state) {
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
