import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { gt, gte, lt, lte, eq } from 'lodash/fp';

const name = Application.applicationName;

export const isTestFlight = name === 'TestFlight';
export const isExpoGo = name === 'Expo Go';
export const isProduction = name === 'Sovran';

export const isDev = isTestFlight || isExpoGo;

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
        this.platformVersion = parseInt(Platform.Version as string, 10);
      } else {
        // For other platforms, we might need different version parsing
        this.platformVersion = parseFloat(Platform.Version as string);
      }
    } else {
      this.platformVersion = null;
    }

    return this;
  }

  private checkVersion(compareFn: (target: number) => (current: number) => boolean) {
    return (version: number): boolean => {
      if (this.platformOS !== Platform.OS || this.platformVersion === null) {
        return false;
      }
      return compareFn(version)(this.platformVersion);
    };
  }

  /**
   * Greater than
   */
  gt = this.checkVersion(gt);

  /**
   * Greater than or equal
   */
  gte = this.checkVersion(gte);

  /**
   * Less than
   */
  lt = this.checkVersion(lt);

  /**
   * Less than or equal
   */
  lte = this.checkVersion(lte);

  /**
   * Equal to
   */
  eq = this.checkVersion(eq);
}

export const device = new DeviceChecker();
