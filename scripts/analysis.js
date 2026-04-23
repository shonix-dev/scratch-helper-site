const fullwidthPattern = /[\uFF01-\uFF5E\u3000]/;
const numericMinusPattern = /ー(?=\d)/g;

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
