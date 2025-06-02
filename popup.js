document.addEventListener("DOMContentLoaded", () => {
  const statusDiv = document.getElementById("status");
  const liveList = document.getElementById("live-list");
  const logoutButton = document.getElementById("logout");

  chrome.runtime.sendMessage({ action: "fetchSessionToken" });

  // Load initial state
  function loadState() {
    chrome.storage.local.get(
      ["kickBearerToken", "followedChannels", "error", "user"],
      (data) => {
        if (!data.kickBearerToken) {
          statusDiv.innerHTML = '<a id="login-link">Log in to Kick.com</a>';
          const loginLink = document.getElementById("login-link");
          loginLink.addEventListener("click", () => {
            chrome.runtime.sendMessage({ action: "initiateLogin" });
          });
          liveList.innerHTML = "";
          logoutButton.style.display = "none";
          return;
        }
        if (data.error) {
          statusDiv.textContent = `Error: ${data.error}`;
        } else {
          statusDiv.textContent = "";
          logoutButton.textContent = `Log Out (${data.user?.username || "User"})`;
          logoutButton.style.display = "block";
        }
        updateLiveStatuses(data.followedChannels || []);
      },
    );
  }

  loadState();

  // Listen for updates from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (
      request.action === "tokenUpdated" ||
      request.action === "channelsUpdated"
    ) {
      loadState();
    }
  });

  // Handle logout
  logoutButton.addEventListener("click", () => {
    chrome.storage.local.remove(
      ["kickBearerToken", "followedChannels", "liveStatuses", "error", "user"],
      () => {
        loadState();
      },
    );
  });

  function updateLiveStatuses(followedChannels) {
    liveList.innerHTML = "";
    followedChannels.forEach((channel) => {
      console.log("Channel:", channel);
      const li = document.createElement("li");
      li.innerHTML = `
        <a href="https://kick.com/${channel.slug}" target="_blank" style="text-decoration: none; color: inherit;">
          <div style="display: flex; align-items: center; padding: 10px;">
            <img src="${channel.profilePic}" alt="Profile Picture" style="width: 50px; height: 50px; border-radius: 50%; margin-right: 10px;">
            <div>
              <div style="font-weight: bold; font-size: 1.2em;">${channel.username}</div>
              <div style="font-size: 0.9em; color: #aaa;">${channel.sessionTitle}</div>
            </div>
          </div>
        </a>
      `;
      liveList.appendChild(li);
    });
  }
});
