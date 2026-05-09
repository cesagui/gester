type TiltPacket = {
  pitch: number;
  roll: number;
  magnitude: number;
} | null;

type BluetoothLEScanFilterLike = {
  namePrefix?: string;
};

type BluetoothRemoteGATTCharacteristicLike = {
  value: DataView | null;
  startNotifications: () => Promise<unknown>;
  readValue: () => Promise<DataView>;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
};

type BluetoothRemoteGATTServiceLike = {
  getCharacteristic: (characteristicUuid: string) => Promise<BluetoothRemoteGATTCharacteristicLike>;
};

type BluetoothRemoteGATTServerLike = {
  connected: boolean;
  connect: () => Promise<BluetoothRemoteGATTServerLike>;
  disconnect: () => void;
  getPrimaryService: (serviceUuid: string) => Promise<BluetoothRemoteGATTServiceLike>;
};

type BluetoothDeviceLike = {
  gatt?: BluetoothRemoteGATTServerLike;
  addEventListener: (type: string, listener: () => void) => void;
};

type BluetoothNavigatorLike = Navigator & {
  bluetooth?: {
    requestDevice: (
      options:
        | {
            filters: BluetoothLEScanFilterLike[];
            optionalServices?: string[];
            acceptAllDevices?: never;
          }
        | {
            acceptAllDevices: true;
            optionalServices?: string[];
            filters?: never;
          },
    ) => Promise<BluetoothDeviceLike>;
  };
};

type BluetoothTiltClientOptions = {
  serviceUuid?: string;
  tiltCharacteristicUuid?: string;
  namePrefix?: string | null;
};

const DEFAULT_OPTIONS: Required<Omit<BluetoothTiltClientOptions, 'namePrefix'>> & {
  namePrefix: string | null;
} = {
  serviceUuid: '5c1b9a0d-b5be-4a40-8f7a-66b36d0a5176',
  tiltCharacteristicUuid: '5c1b9a0d-b5be-4a40-8f7a-66b36d0a5177',
  namePrefix: null,
};

export class BluetoothTiltClient {
  private options: typeof DEFAULT_OPTIONS;

  private device: BluetoothDeviceLike | null = null;

  private server: BluetoothRemoteGATTServerLike | null = null;

  private service: BluetoothRemoteGATTServiceLike | null = null;

  private tiltCharacteristic: BluetoothRemoteGATTCharacteristicLike | null = null;

  public onTilt: ((tilt: TiltPacket) => void) | null = null;

  public onDisconnect: (() => void) | null = null;

  constructor(options: BluetoothTiltClientOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async requestDevice() {
    const bluetoothNavigator = navigator as BluetoothNavigatorLike;

    if (!bluetoothNavigator.bluetooth) {
      throw new Error('Web Bluetooth is not available in this browser.');
    }

    const filters: BluetoothLEScanFilterLike[] = [];
    if (this.options.namePrefix) {
      filters.push({ namePrefix: this.options.namePrefix });
    }

    const requestOptions = filters.length
      ? {
          filters,
          optionalServices: [this.options.serviceUuid],
        }
      : {
          acceptAllDevices: true as const,
          optionalServices: [this.options.serviceUuid],
        };

    const device = await bluetoothNavigator.bluetooth.requestDevice(requestOptions);

    this.device = device;
    this.device.addEventListener('gattserverdisconnected', () => {
      this.server = null;
      this.service = null;
      this.tiltCharacteristic = null;
      if (typeof this.onDisconnect === 'function') {
        this.onDisconnect();
      }
    });

    return device;
  }

  async connect() {
    if (!this.device) {
      await this.requestDevice();
    }

    if (!this.device?.gatt) {
      throw new Error('Selected device does not provide a GATT server.');
    }

    this.server = await this.device.gatt.connect();
    this.service = await this.server.getPrimaryService(this.options.serviceUuid);
    this.tiltCharacteristic = await this.service.getCharacteristic(this.options.tiltCharacteristicUuid);

    await this.startTiltNotifications();
    return this;
  }

  async disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }

  async startTiltNotifications() {
    if (!this.tiltCharacteristic) {
      throw new Error('Tilt characteristic is not ready.');
    }

    await this.tiltCharacteristic.startNotifications();
    this.tiltCharacteristic.addEventListener('characteristicvaluechanged', this.handleTiltNotification);
  }

  private handleTiltNotification = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristicLike | null;
    const value = target?.value;
    const tilt = this.parseTiltValue(value ?? null);

    if (typeof this.onTilt === 'function') {
      this.onTilt(tilt);
    }
  };

  parseTiltValue(dataView: DataView | null): TiltPacket {
    if (!dataView || dataView.byteLength === 0) {
      return null;
    }

    if (dataView.byteLength >= 24) {
      return {
        pitch: dataView.getFloat64(0, true),
        roll: dataView.getFloat64(8, true),
        magnitude: dataView.getFloat64(16, true),
      };
    }

    return null;
  }

  async readTilt() {
    if (!this.tiltCharacteristic) {
      throw new Error('Tilt characteristic is not ready.');
    }

    const value = await this.tiltCharacteristic.readValue();
    return this.parseTiltValue(value);
  }
}

export type { TiltPacket };
