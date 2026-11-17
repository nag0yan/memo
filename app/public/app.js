const loginPanel = document.querySelector("#login-panel");
const memoPanel = document.querySelector("#memo-panel");
const loginForm = document.querySelector("#login-form");
const newPasswordForm = document.querySelector("#new-password-form");
const loginMessage = document.querySelector("#login-message");
const appMessage = document.querySelector("#app-message");
const memoForm = document.querySelector("#memo-form");
const memoList = document.querySelector("#memo-list");
const emptyState = document.querySelector("#empty-state");
const memoCount = document.querySelector("#memo-count");
const logoutButton = document.querySelector("#logout");
const cancelEditButton = document.querySelector("#cancel-edit");
const formTitle = document.querySelector("#form-title");
const saveLabel = document.querySelector("#save-label");
let editingId = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) {
    return null;
  }
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "処理に失敗しました。");
  }
  return body;
}

function showLogin() {
  loginPanel.hidden = false;
  memoPanel.hidden = true;
  logoutButton.hidden = true;
}

function showMemos() {
  loginPanel.hidden = true;
  memoPanel.hidden = false;
  logoutButton.hidden = false;
  loadMemos();
}

async function loadMemos() {
  try {
    const memos = await api("/api/memos");
    renderMemos(memos);
  } catch (error) {
    if (error.message === "ログインしてください。") {
      showLogin();
      return;
    }
    appMessage.textContent = error.message;
  }
}

function renderMemos(memos) {
  memoList.replaceChildren();
  memoCount.textContent = `${memos.length}件`;
  emptyState.hidden = memos.length !== 0;

  for (const memo of memos) {
    const article = document.createElement("article");
    article.className = "memo-card";

    const heading = document.createElement("div");
    heading.className = "memo-card-heading";
    const title = document.createElement("h2");
    title.textContent = memo.title;
    const date = document.createElement("time");
    date.dateTime = memo.updatedAt;
    date.textContent = new Date(memo.updatedAt).toLocaleString("ja-JP");
    heading.append(title, date);

    const content = document.createElement("p");
    content.className = "memo-content";
    content.textContent = memo.content || "（本文なし）";

    const actions = document.createElement("div");
    actions.className = "memo-actions";
    const editButton = document.createElement("button");
    editButton.className = "text-button";
    editButton.type = "button";
    editButton.textContent = "編集";
    editButton.addEventListener("click", () => beginEdit(memo));
    const deleteButton = document.createElement("button");
    deleteButton.className = "text-button text-button-danger";
    deleteButton.type = "button";
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", () => deleteMemo(memo.id));
    actions.append(editButton, deleteButton);

    article.append(heading, content, actions);
    memoList.append(article);
  }
}

function beginEdit(memo) {
  editingId = memo.id;
  document.querySelector("#memo-title").value = memo.title;
  document.querySelector("#memo-content").value = memo.content;
  formTitle.textContent = "メモを編集";
  saveLabel.textContent = "変更を保存";
  cancelEditButton.hidden = false;
  document.querySelector("#memo-title").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetMemoForm() {
  editingId = null;
  memoForm.reset();
  formTitle.textContent = "新しいメモ";
  saveLabel.textContent = "保存";
  cancelEditButton.hidden = true;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";
  const formData = new FormData(loginForm);
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    document.querySelector("#password").value = "";
    if (result.challenge === "NEW_PASSWORD_REQUIRED") {
      loginForm.hidden = true;
      newPasswordForm.hidden = false;
      document.querySelector("#new-password").focus();
      return;
    }
    showMemos();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

newPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";
  const formData = new FormData(newPasswordForm);
  try {
    await api("/api/auth/new-password", {
      method: "POST",
      body: JSON.stringify({ newPassword: formData.get("newPassword") }),
    });
    newPasswordForm.reset();
    showMemos();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

memoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  appMessage.textContent = "";
  const formData = new FormData(memoForm);
  const memo = {
    title: formData.get("title"),
    content: formData.get("content"),
  };
  try {
    await api(editingId ? `/api/memos/${editingId}` : "/api/memos", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(memo),
    });
    resetMemoForm();
    await loadMemos();
  } catch (error) {
    appMessage.textContent = error.message;
  }
});

cancelEditButton.addEventListener("click", resetMemoForm);

async function deleteMemo(id) {
  if (!window.confirm("このメモを削除しますか？")) {
    return;
  }
  appMessage.textContent = "";
  try {
    await api(`/api/memos/${id}`, { method: "DELETE" });
    await loadMemos();
  } catch (error) {
    appMessage.textContent = error.message;
  }
}

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    resetMemoForm();
    showLogin();
  } catch (error) {
    appMessage.textContent = error.message;
  }
});

try {
  await api("/api/me");
  showMemos();
} catch {
  showLogin();
}
