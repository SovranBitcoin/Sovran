// Applied by patch-bitchat-imports.js after each vendor checkout. Only scanning
// is duty-cycled; advertising, established links, and message delivery stay live.
function patchIdleDiscovery(source) {
  if (source.includes('// [sovran] bounded discovery')) return source;
  function replaceOnce(before, after) {
    if (!source.includes(before)) throw new Error(`BLE discovery patch anchor missing: ${before}`);
    source = source.replace(before, after);
  }
  replaceOnce(
    '    private var scanDutyTimer: DispatchSourceTimer?',
    `    // [sovran] bounded discovery
    private var sovranDiscoveryUntil = Date().addingTimeInterval(30)
    private var sovranScanGeneration = 0
    private var scanDutyTimer: DispatchSourceTimer?`
  );
  replaceOnce(
    '    func startServices() {',
    `    func requestDiscoveryWindow() {
        bleQueue.async { [weak self] in
            guard let self else { return }
            self.sovranDiscoveryUntil = Date().addingTimeInterval(30)
            self.sovranScanGeneration += 1
            self.scanDutyTimer?.cancel()
            self.scanDutyTimer = nil
            self.centralManager?.stopScan()
            self.startScanning()
        }
    }

    func startServices() {
        requestDiscoveryWindow()`
  );
  // Invalidate a queued duty callback before stopping or releasing the service.
  source = source.replaceAll(
    '        maintenanceTimer?.cancel()\n        scanDutyTimer?.cancel()',
    '        maintenanceTimer?.cancel()\n        sovranScanGeneration += 1\n        scanDutyTimer?.cancel()'
  );
  replaceOnce(
    '        maintenanceTimer = nil\n        scanDutyTimer?.cancel()',
    '        maintenanceTimer = nil\n        sovranScanGeneration += 1\n        scanDutyTimer?.cancel()'
  );
  replaceOnce(
    'let allowDuplicates = isAppActive  // Use our tracked state (thread-safe)',
    'let allowDuplicates = isAppActive && Date() < sovranDiscoveryUntil'
  );
  const start = source.indexOf('    private func updateScanningDutyCycle(connectedCount: Int) {');
  const end = source.indexOf('    private func updateRSSIThreshold', start);
  if (start < 0 || end < 0) throw new Error('BLE discovery duty-cycle anchors missing');
  source =
    source.slice(0, start) +
    `    private func updateScanningDutyCycle(connectedCount: Int) {
        guard let central = centralManager, central.state == .poweredOn else { return }
        #if os(iOS)
        let active = isAppActive
        #else
        let active = true
        #endif
        let hasRecentTraffic: Bool = collectionsQueue.sync {
            let cutoff = Date().addingTimeInterval(-TransportConfig.bleRecentTrafficForceScanSeconds)
            return recentPacketTimestamps.contains(where: { $0 >= cutoff })
        }
        let shouldDuty = dutyEnabled && active && Date() >= sovranDiscoveryUntil && !hasRecentTraffic
        if !shouldDuty {
            sovranScanGeneration += 1
            scanDutyTimer?.cancel()
            scanDutyTimer = nil
            if !central.isScanning { startScanning() }
            return
        }
        guard scanDutyTimer == nil else { return }
        // Idle discovery: five seconds on, ten off, including zero neighbors.
        // A new explicit discovery request opens another thirty-second window.
        sovranScanGeneration += 1
        let generation = sovranScanGeneration
        let dense = connectedCount >= TransportConfig.bleHighDegreeThreshold
        let onDuration = dense ? TransportConfig.bleDutyOnDurationDense : 5.0
        let offDuration = dense ? TransportConfig.bleDutyOffDurationDense : 10.0
        let timer = DispatchSource.makeTimerSource(queue: bleQueue)
        scanDutyTimer = timer
        if central.isScanning { central.stopScan() }
        startScanning()
        timer.schedule(deadline: .now() + onDuration)
        timer.setEventHandler { [weak self] in
            guard let self, self.sovranScanGeneration == generation,
                  let central = self.centralManager, central.state == .poweredOn else { return }
            if central.isScanning {
                central.stopScan()
                self.scanDutyTimer?.schedule(deadline: .now() + offDuration)
            } else {
                self.startScanning()
                self.scanDutyTimer?.schedule(deadline: .now() + onDuration)
            }
        }
        timer.resume()
    }

` +
    source.slice(end);
  return source;
}

module.exports = { patchIdleDiscovery };
