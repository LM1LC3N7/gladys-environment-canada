// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
// It records every call the integration makes, so tests can assert them
// without a running Gladys server or a real WebSocket.
// -----------------------------------------------------------------------------

export function createFakeGladys({ houses = [] } = {}) {
  const sceneEvents = [];
  const widgetRefreshes = [];
  const weatherRefreshes = [];
  const connectionStatuses = [];

  return {
    houses,
    sceneEvents,
    widgetRefreshes,
    weatherRefreshes,
    connectionStatuses,
    rejectSceneEvents: false,

    async getHouses() {
      if (this.houses instanceof Error) {
        throw this.houses;
      }
      return this.houses;
    },

    async publishSceneEvent(key, data = {}) {
      if (this.rejectSceneEvents) {
        throw new Error('429 Too Many Requests');
      }
      sceneEvents.push({ key, data });
      return { success: true };
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },

    // Fire-and-forget in the SDK too: synchronous, resolves nothing.
    requestWidgetRefresh(key) {
      widgetRefreshes.push(key);
    },

    requestWeatherRefresh() {
      weatherRefreshes.push(Date.now());
    },
  };
}
