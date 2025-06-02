chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("checkLiveStatus", { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkLiveStatus") {
    fetchFollowedChannelsAndCheckStatuses();
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "initiateLogin") {
    chrome.tabs.create({ url: "https://kick.com/login" }, (tab) => {
      console.log("Opened login tab:", tab.id);
    });
  } else if (request.action === "fetchSessionToken") {
    extractSessionToken();
  }
});

function extractSessionToken() {
  chrome.cookies.get(
    { url: "https://kick.com", name: "session_token" },
    (cookie) => {
      if (cookie) {
        console.log("Session token found:", cookie.value);
        const decodedToken = decodeURIComponent(cookie.value);
        chrome.storage.local.set({ kickBearerToken: decodedToken }, () => {
          console.log("Session token updated in storage");
          // Notify popup of token update
          chrome.runtime.sendMessage({ action: "tokenUpdated" });
          fetchFollowedChannelsAndCheckStatuses();
        });
      } else {
        console.log("Session token not found");
        chrome.storage.local.remove("kickBearerToken");
        chrome.storage.local.set({ error: "Please log in to Kick.com" });
      }
    },
  );
}

async function fetchFollowedChannelsAndCheckStatuses() {
  const { kickBearerToken } = await chrome.storage.local.get("kickBearerToken");
  if (!kickBearerToken) {
    console.log("No token available");
    chrome.storage.local.set({ error: "No authentication token" });
    return;
  }

  const headers = {
    Authorization: `Bearer ${kickBearerToken}`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  };

  // Step 1: Get user ID
  let userId;
  let username;
  try {
    const userResponse = await fetchWithRetry("https://kick.com/api/v1/user", {
      headers,
    });
    userId = userResponse.id;
    username = userResponse.username;
    console.log("User ID:", userId);
  } catch (error) {
    console.error("Error fetching user ID:", error);
    chrome.storage.local.set({ error: "Failed to fetch user data" });
    return;
  }
  let user = { username, userId };
  chrome.storage.local.set({ user }, () => {
    console.log("user saved:", user);
  });

  // Step 2: Get followed channels
  let followedChannels = [];
  try {
    const channelsResponse = await fetchWithRetry(
      `https://kick.com/api/v1/user/livestreams`,
      { headers },
    );
    followedChannels = channelsResponse.map((channel) => ({
      slug: channel.channel.slug,
      username: channel.channel.user.username,
      isLive: channel.is_live,
      sessionTitle: channel.session_title,
      profilePic: channel.channel.user.profilepic,
    }));
    chrome.storage.local.set({ followedChannels }, () => {
      console.log("Followed channels:", followedChannels);
      // Notify popup of channel update
      chrome.runtime.sendMessage({ action: "channelsUpdated" });
    });

    return followedChannels;
  } catch (error) {
    console.error("Error fetching followed channels:", error);
  }
}

async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        if (response.status === 401) {
          chrome.storage.local.remove("kickBearerToken");
          throw new Error("Session expired");
        }
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Fetch attempt ${i + 1} failed for ${url}:`, error);
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay * 2 ** i));
    }
  }
}
