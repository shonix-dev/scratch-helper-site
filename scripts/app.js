const state = {
  project: null,
  analysis: null,
  fileName: "",
};

$("#fileInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const project = await loadSb3Data(file);
    state.project = project;
    state.fileName = file.name;
    state.analysis = analyzeProject(project);
    render(state);
  } catch (error) {
    alert(`読み込みに失敗しました: ${error.message}`);
  }
});

$("#audience").addEventListener("change", () => {
  if (state.analysis) renderTeacher(state);
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
