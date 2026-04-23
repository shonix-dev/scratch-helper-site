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
