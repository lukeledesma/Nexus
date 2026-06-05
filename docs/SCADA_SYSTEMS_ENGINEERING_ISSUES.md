# SCADA / Systems Engineering Issues

## Problem and Solution Breakdown

**Prepared for:** Management and Engineering Leadership  
**Purpose:** Clarify recurring operational issues, identify likely root causes, and define actionable remediation steps.

## Executive Summary

The current operating pattern reflects systemic risk rather than isolated technical failures. Across MQTT communications, edge infrastructure, legacy deployment, vendor reliability, administrative overhead, and project delivery, the organization is experiencing recurring issues caused by under-structured processes, constrained resourcing, and blurred ownership boundaries.

Primary risks include:

- Service reliability degradation
- Elevated operational and safety exposure
- Single-person dependency on critical systems
- Reduced engineering throughput due to continuous interruption

## 1. MQTT Publishing Failures (Multiple Customers)

### Problem

- One customer MQTT device does not publish at all.
- Another device publishes intermittently, creating a false sense of system health.
- Data inconsistency introduces operational and safety risk.
- Vendor support is slow or unresponsive.
- Existing workarounds consume time and cost without resolving root causes.

### Likely Root Causes

- Incorrect or unstable MQTT client implementation on customer-side devices
- Sparkplug B compliance gaps
- Broker configuration mismatches
- Network instability or QoS misalignment
- Unclear troubleshooting ownership between parties

### Proposed Solutions

- Formalize an MQTT diagnostic checklist covering:
  - Broker logs
  - Client logs
  - Sparkplug B compliance
  - QoS settings
  - Retained message behavior
  - Birth/death certificate handling
- Escalate unresolved vendor support through management channels.
- Deploy MQTT health dashboards to detect stale or missing data early.
- Establish clear support boundaries between internal team, vendor, and customer.
- Long term: redesign architecture to reduce dependency on unreliable MQTT clients.

## 2. Edge Node (Raspberry Pi + Ignition Edge) Unreliable Over Cellular

### Problem

- System performs well on LAN.
- Performance degrades significantly over cellular when opening Designer or PLC programs.
- Data drops, latency spikes, and CPU load increase sharply.
- Real-time troubleshooting and development are not practical in this mode.

### Likely Root Causes

- Cellular bandwidth saturation during Designer and PLC traffic
- NAT traversal overhead
- Encryption overhead on constrained hardware
- Throughput contention across MQTT, OPC, Designer, and remote PLC programming traffic
- Potential NetBird or routing priority misconfiguration

### Proposed Solutions

- Implement traffic shaping and QoS to prioritize SCADA data traffic.
- Use SSH tunneling or VPN split tunneling to reduce avoidable overhead.
- Move heavy engineering tasks to a staging environment instead of live cellular links.
- Evaluate upgraded hardware with stronger CPU and network performance.
- Document cellular constraints and align expectations with management and customers.

## 3. Legacy SCADA System With High-Risk Deployment Process

### Problem

- Existing SCADA system is large, tightly coupled, and difficult to deploy safely.
- Deployments affect the full system at once.
- Deployment failures can trigger full outages.
- No rollback mechanism is in place.
- Undeployed or unknown changes remain in the environment.
- One engineer holds most of the operational knowledge.

### Likely Root Causes

- No formal version control or deployment pipeline
- No staging or validation environment
- Long-accumulated technical debt
- Limited documentation and knowledge sharing
- Single point of failure in staffing model

### Proposed Solutions

- Create and enforce a deployment protocol with:
  - Pre-deployment validation
  - Backup and checkpoint requirements
  - Recovery steps
- Implement Git version control for all project artifacts.
- Stand up a staging environment for safe deployment validation.
- Begin architecture and component documentation for unknown areas.
- Cross-train at least one additional engineer.
- Propose and phase a modernization roadmap.

## 4. Uticor Radios: Reliability and Vendor Support Gaps

### Problem

- Radio behavior is inconsistent and unreliable.
- Hardware selection appears cost-driven rather than performance-driven.
- Vendor support is insufficient or delayed.
- Internal team is expected to provide answers without required visibility or tooling.

### Likely Root Causes

- Hardware capability limitations
- Firmware instability
- RF interference or antenna design limitations
- Inadequate vendor technical support
- Procurement trade-offs favoring cost over reliability

### Proposed Solutions

- Capture and track failure patterns with structured incident logs.
- Escalate vendor non-responsiveness through management.
- Evaluate alternative vendors and provide cost-benefit analysis.
- Define support boundaries: unreliable hardware cannot be fully corrected through technician effort alone.
- Recommend phased replacement for critical links.

## 5. Time Card Process Misaligned With Interrupt-Driven Engineering Work

### Problem

- Current process requires one sentence per hour.
- Emergency calls and production failures interrupt logging.
- Administrative backlog accumulates, increasing stress and billing delays.
- Process penalizes high-value emergency response work.

### Likely Root Causes

- Tracking model not designed for interruption-heavy engineering roles
- No policy buffer for emergency-response periods
- No tooling or automation support

### Proposed Solutions

- Standardize a daily summary template expandable into hourly entries.
- Request emergency-day policy adjustments allowing block entries.
- Introduce lightweight capture workflow (quick notes or mobile log method).
- Shift to weekly review and reconciliation instead of strict real-time hourly logging.

## 6. Large Unfinished SCADA Project With Unrealistic Delivery Expectations

### Problem

- Project scope is large and has remained incomplete for an extended period.
- Progress was made by two engineers, then disrupted by emergency reassignments.
- Remaining engineer is now carrying disproportionate load.
- Delivery expectations remain unchanged despite reduced capacity.

### Likely Root Causes

- Understaffing
- No formal project management or prioritization control
- Constant interruption preventing deep work
- Aggressive timelines disconnected from available capacity

### Proposed Solutions

- Require a formal project plan with milestones, roles, and protected engineering time.
- Reassign emergency duties during planned SCADA development windows.
- Add engineering capacity where feasible.
- Break work into smaller, reportable deliverables to improve visibility and momentum.

## Cross-Issue Pattern

Across all issue areas, the same structural pattern appears:

- Architectural debt and vendor failure are being absorbed by front-line engineering.
- Critical responsibilities exceed current authority, staffing, and process support.
- Multiple systems depend on single-person knowledge.
- Engineering time is dominated by firefighting.
- Accountability extends beyond controllable boundaries.

**Conclusion:** This is not an individual performance issue. It is a workload, support, and organizational structure issue.

## Action Plan (Concise and Executable)

1. **Reset priorities with management.**
   - Present this document.
   - Obtain explicit decisions on what to do first, pause, drop, or resource.
2. **Establish support boundaries.**
   - Define what is internally fixable.
   - Define what requires vendor action, redesign, or additional staffing.
3. **Implement safer engineering practices.**
   - Version control
   - Staging environments
   - Deployment protocols
   - Legacy system documentation
4. **Protect engineering focus time.**
   - Schedule deep-work blocks.
   - Reduce interruption volume during planned development periods.
   - Clarify escalation channels.
5. **Fix time-card workflow friction.**
   - Use daily summary templates.
   - Request emergency-day policy flexibility.
6. **Reduce single-person dependency.**
   - Cross-train another engineer.
   - Document tribal knowledge.
   - Distribute operational ownership.

## Suggested Immediate Next Steps (30-Day Window)

- Week 1: Align with management on priorities and boundaries.
- Week 2: Publish MQTT diagnostics checklist and legacy deployment protocol.
- Week 3: Start staging environment plan and cross-training assignments.
- Week 4: Deliver vendor escalation package and replacement recommendations for highest-risk hardware.
