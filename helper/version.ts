import * as Application from 'expo-application';
import { Platform } from 'react-native';

const name = Application.applicationName;

const isTestFlight = name === 'TestFlight';
const isExpoGo = name === 'Expo Go';
const isProduction = name === 'Sovran';

const isDev = isTestFlight || isExpoGo;

/**
 * Generic device platform version checking with fluent API
 * Usage: device.platform("ios").gte(10) or device.platform("android").gte(21)
 */
class DeviceChecker {
  private platformOS: string | null = null;
  private platformVersion: number | null = null;

  platform(platform: 'ios' | 'android' | 'web' | 'windows' | 'macos'): DeviceChecker {
    this.platformOS = platform;

    if (Platform.OS === platform) {
      if (platform === 'ios' || platform === 'android') {
        // For iOS and Android, parse the version as integer
        this.platformVersion = parseInt(Platform.Version as string, 10);
      } else {
        // For other platforms, use float parsing
        this.platformVersion = parseFloat(Platform.Version as string);
      }
    } else {
      this.platformVersion = null;
    }

    return this;
  }

  private isValidPlatform(): boolean {
    return this.platformOS === Platform.OS && this.platformVersion !== null;
  }

  /**
   * Greater than
   */
  gt = (version: number): boolean => {
    if (!this.isValidPlatform()) return false;
    return this.platformVersion! > version;
  };

  /**
   * Greater than or equal
   */
  gte = (version: number): boolean => {
    if (!this.isValidPlatform()) return false;
    return this.platformVersion! >= version;
  };

  /**
   * Less than
   */
  lt = (version: number): boolean => {
    if (!this.isValidPlatform()) return false;
    return this.platformVersion! < version;
  };

  /**
   * Less than or equal
   */
  lte = (version: number): boolean => {
    if (!this.isValidPlatform()) return false;
    return this.platformVersion! <= version;
  };

  /**
   * Equal to
   */
  eq = (version: number): boolean => {
    if (!this.isValidPlatform()) return false;
    return this.platformVersion! === version;
  };
}

export const device = new DeviceChecker();
