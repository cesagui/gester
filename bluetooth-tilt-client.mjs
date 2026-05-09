const DEFAULT_OPTIONS = {
  serviceUuid: "0000ffff-0000-1000-8000-00805f9b34fb",
  tiltCharacteristicUuid: "0000fffe-0000-1000-8000-00805f9b34fb",
  namePrefix: null,
};

/**
 * Minimal Web Bluetooth client skeleton for a microcontroller that exposes tilt data.
 * Replace the UUIDs above with the values used by your firmware.
 */
export class BluetoothTiltClient {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.device = null;
    this.server = null;
    this.service = null;
    this.tiltCharacteristic = null;
    this.onTilt = null;
    this.onDisconnect = null;
  }

  async requestDevice() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser.");
    }

    const filters = [];
    // all names that once start with specified prefix to be selected
    if (this.options.namePrefix) {
      filters.push({ namePrefix: this.options.namePrefix });
    }

    // prompt user to select a device
    const device = await navigator.bluetooth.requestDevice({
      filters: filters.length ? filters : undefined,
      optionalServices: [this.options.serviceUuid],
    });

    // save the selected BT device
    this.device = device;
    // add an event listener when the device disconnects
    this.device.addEventListener("gattserverdisconnected", () => {
      this.server = null;
      this.service = null;
      this.tiltCharacteristic = null;
      if (typeof this.onDisconnect === "function") {
        this.onDisconnect();
      }
    });

    return device;
  }

  async connect() {
    // if no device def ? request it
    if (!this.device) {
      await this.requestDevice();
    }
    
    // connect to the GATT server on the 
    this.server = await this.device.gatt.connect();
    // get the services grouped under the same service
    this.service = await this.server.getPrimaryService(this.options.serviceUuid);
    // tilt characteristics is specifically under that uuid
    this.tiltCharacteristic = await this.service.getCharacteristic(
      this.options.tiltCharacteristicUuid,
    );

    await this.startTiltNotifications();
    return this;
  }

  async disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }

  async startTiltNotifications() {
    // if tilt char unavail
    if (!this.tiltCharacteristic) {
      throw new Error("Tilt characteristic is not ready.");
    }

    // tell device to send notifs on val change (vs poll)
    await this.tiltCharacteristic.startNotifications();
    // detect value change events on each call to handle tilt notif
    this.tiltCharacteristic.addEventListener(
      "characteristicvaluechanged",
      this.handleTiltNotification,
    );
  }

  handleTiltNotification = (event) => {
    const value = event.target.value;
    const tilt = this.parseTiltValue(value);

    if (typeof this.onTilt === "function") {
      this.onTilt(tilt);
    }
  };

  parseTiltValue(dataView) {
    // Adjust this parser to match how the microcontroller encodes tilt data.
    if (!dataView || dataView.byteLength === 0) {
      return null;
    }

    if (dataView.byteLength >= 8) {
      return {
        x: dataView.getFloat32(0, true),
        y: dataView.getFloat32(4, true),
      };
    }

    if (dataView.byteLength >= 2) {
      return {
        x: dataView.getInt8(0),
        y: dataView.getInt8(1),
      };
    }

    return dataView.getUint8(0);
  }

  async readTilt() {
    if (!this.tiltCharacteristic) {
      throw new Error("Tilt characteristic is not ready.");
    }

    const value = await this.tiltCharacteristic.readValue();
    return this.parseTiltValue(value);
  }
}
