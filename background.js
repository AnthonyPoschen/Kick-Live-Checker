chrome.runtime.onInstalled.addListener(() => {
  extractSessionToken();
  chrome.alarms.create("checkLiveStatus", { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkLiveStatus") {
    extractSessionToken();
    fetchFollowedChannelsAndCheckStatuses();
  }
});

// Monitor tab updates to detect login completion
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url.startsWith("https://kick.com")
  ) {
    // Check if the URL indicates a post-login page (e.g., homepage, dashboard)
    if (tab.url === "https://kick.com/" || tab.url.includes("/dashboard")) {
      console.log("Detected potential post-login page:", tab.url);
      pollForSessionToken();
    }
  }
});

// Handle messages from popup (e.g., initiate login)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "initiateLogin") {
    chrome.tabs.create({ url: "https://kick.com/login" }, (tab) => {
      console.log("Opened login tab:", tab.id);
    });
  }
});

function extractSessionToken() {
  chrome.cookies.get(
    { url: "https://kick.com", name: "session_token" },
    (cookie) => {
      if (cookie) {
        console.log("Session token found:", cookie.value);
        const decodedToken = decodeURIComponent(cookie.value);
        chrome.storage.local.get("kickBearerToken", (result) => {
          if (result.kickBearerToken !== decodedToken) {
            console.log("Session token has changed. Updating storage.");
            chrome.storage.local.set({ kickBearerToken: decodedToken }, () => {
              console.log("Session token updated in storage");
              fetchFollowedChannelsAndCheckStatuses();
            });
          } else {
            console.log("Session token is already up-to-date.");
          }
        });
      } else {
        console.log("Session token not found");
        chrome.storage.local.remove("kickBearerToken");
        chrome.storage.local.set({ error: "Please log in to Kick.com" });
      }
    },
  );
}

// Poll for session token after login
function pollForSessionToken(attempts = 5, interval = 2000) {
  let currentAttempt = 0;
  const poll = setInterval(() => {
    chrome.cookies.get(
      { url: "https://kick.com", name: "session_token" },
      (cookie) => {
        currentAttempt++;
        if (cookie) {
          console.log("Session token found after polling:", cookie.value);
          chrome.storage.local.set({ kickBearerToken: cookie.value }, () => {
            console.log("Session token saved after polling");
            fetchFollowedChannelsAndCheckStatuses();
          });
          clearInterval(poll);
        } else if (currentAttempt >= attempts) {
          console.log("Session token not found after polling");
          chrome.storage.local.set({
            error: "Login failed or session token not set",
          });
          clearInterval(poll);
        }
      },
    );
  }, interval);
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
	chrome.storage.local.set({user}, () => {
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
    });

    return followedChannels;
  } catch (error) {
    console.error("Error fetching followed channels:", error);
  }

  //
  // // Notify if any followed channel is live
  // results.forEach(({ channel, isLive }) => {
  //   if (isLive) {
  //     chrome.notifications.create({
  //       type: "basic",
  //       iconUrl: "icon.png",
  //       title: "Kick.com Live",
  //       message: `${channel} is now live!`,
  //     });
  //   }
  // });
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
