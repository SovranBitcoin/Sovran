import Expo
import ExpoModulesCore
import Foundation

/// Gives `expo/fetch` a URLSession that waits longer than 60 seconds for the
/// next byte.
///
/// Expo's fetch sets `timeoutInterval = 0` on each request, which hands the
/// decision to the session configuration — and `URLSessionConfiguration.default`
/// gives up after 60 seconds of silence. A Routstr node paid per request
/// (`X-Cashu`) buffers the WHOLE upstream answer, prices it and mints change
/// before it sends a single byte, and puts no timeout on its own upstream. So
/// any completion that takes the model more than a minute to generate died at
/// exactly 60 seconds with "The request timed out" — after the node had already
/// redeemed the token. The 2026-09-26 log has one at 60.65 s: 1,864 sats
/// parked in the node's refund row, and no answer.
///
/// The JavaScript deadlines (`shared/lib/routstr/requestDeadline.ts`) are the
/// ones meant to decide when a request has waited long enough, and they sit
/// under this value; this only stops the OS from deciding first.
public class NetworkTimeoutsModule: Module {
  /// Seconds of silence before iOS abandons a request. Long enough for a
  /// 2,000-token answer from a slow model; short enough that a genuinely hung
  /// connection is still released without the JavaScript side.
  static let requestIdleTimeoutSeconds: TimeInterval = 300

  public func definition() -> ModuleDefinition {
    Name("NetworkTimeouts")

    OnCreate {
      // `setCustomURLSessionConfigurationProvider` is MainActor-isolated and
      // `OnCreate` is not. `ExpoFetchModule` builds its session lazily, on the
      // first fetch from JavaScript, which is long after this hop lands.
      Task { @MainActor in
        ExpoFetchCustomExtension.setCustomURLSessionConfigurationProvider {
          // What `ExpoFetchModule.createURLSession` does when no provider is
          // set, plus the one change. Kept in step with expo/ios/Fetch.
          let config = URLSessionConfiguration.default
          config.httpShouldSetCookies = true
          config.httpCookieAcceptPolicy = .always
          config.httpCookieStorage = HTTPCookieStorage.shared
          let useWifiOnly = Bundle.main.infoDictionary?["ReactNetworkForceWifiOnly"] as? Bool ?? false
          if useWifiOnly {
            config.allowsCellularAccess = false
          }
          config.timeoutIntervalForRequest = NetworkTimeoutsModule.requestIdleTimeoutSeconds
          return config
        }
      }
    }
  }
}
