type SampleCollectionName = 'service_requests' | 'inspections' | 'permits' | 'projects';

type SampleCollections = Record<SampleCollectionName, Record<string, unknown>[]>;

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  int(min: number, max: number) {
    return Math.round(min + this.next() * (max - min));
  }
}

function isoDate(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

export function generateSampleCollections(tenantId: string): SampleCollections {
  const rng = new SeededRandom(0x5eed1234);

  const municipalities = [
    'Doha',
    'Al Rayyan',
    'Al Wakrah',
    'Al Khor and Al Dhakira',
    'Umm Salal',
    'Al Daayen',
    'Al Shamal',
    'Al Sheehaniya',
  ];
  const zones = ['Zone 1', 'Zone 5', 'Zone 12', 'Zone 27', 'Zone 45', 'Zone 61', 'Zone 69'];
  const districts = [
    'West Bay',
    'Lusail',
    'Mesaieed',
    'Al Gharrafa',
    'Al Khor',
    'Madinat Khalifa',
    'Al Ruwais',
  ];
  const topics = ['Public Cleanliness', 'Roads', 'Parks', 'Drainage', 'Street Lighting', 'Markets'];
  const serviceTypes = [
    'Waste Collection',
    'Road Maintenance',
    'Tree Trimming',
    'Drainage Issue',
    'Streetlight Repair',
    'Public Facility Complaint',
  ];
  const requestStatuses = ['new', 'in_review', 'in_progress', 'resolved', 'closed'] as const;
  const priorities = ['low', 'medium', 'high', 'urgent'] as const;
  const channels = ['mobile_app', 'call_center', 'portal', 'field_team'] as const;

  const serviceRequests = Array.from({ length: 700 }, (_, i) => {
    const daysAgo = rng.next() < 0.6 ? rng.int(0, 35) : rng.int(35, 365);
    return {
      _id: `sr_${i + 1}`,
      tenantId,
      requestNumber: `REQ-${10000 + i}`,
      municipality: rng.pick(municipalities),
      zone: rng.pick(zones),
      district: rng.pick(districts),
      topic: rng.pick(topics),
      serviceType: rng.pick(serviceTypes),
      status: rng.pick([...requestStatuses]),
      priority: rng.pick([...priorities]),
      channel: rng.pick([...channels]),
      responseHours: rng.int(1, 72),
      resolutionDays: rng.int(1, 21),
      createdAt: isoDate(daysAgo),
    };
  });

  const inspectionTypes = [
    'Food Safety',
    'Building Compliance',
    'Street Vendor',
    'Public Health',
    'Construction Site',
  ];
  const outcomes = ['compliant', 'warning', 'violation', 'follow_up'] as const;
  const inspectorTeams = ['North Field Team', 'Doha Field Team', 'Coastal Team', 'Planning Compliance'];

  const inspections = Array.from({ length: 260 }, (_, i) => ({
    _id: `ins_${i + 1}`,
    tenantId,
    municipality: rng.pick(municipalities),
    zone: rng.pick(zones),
    inspectionType: rng.pick(inspectionTypes),
    outcome: rng.pick([...outcomes]),
    inspectorTeam: rng.pick(inspectorTeams),
    score: rng.int(55, 100),
    createdAt: isoDate(rng.int(0, 180)),
  }));

  const permitTypes = [
    'Building Permit',
    'Excavation Permit',
    'Signage Permit',
    'Event Permit',
    'Temporary Closure Permit',
  ];
  const permitStatuses = ['submitted', 'under_review', 'approved', 'rejected', 'expired'] as const;
  const applicantTypes = ['individual', 'business', 'government'] as const;

  const permits = Array.from({ length: 240 }, (_, i) => ({
    _id: `per_${i + 1}`,
    tenantId,
    permitNumber: `PER-${20000 + i}`,
    municipality: rng.pick(municipalities),
    zone: rng.pick(zones),
    permitType: rng.pick(permitTypes),
    status: rng.pick([...permitStatuses]),
    applicantType: rng.pick([...applicantTypes]),
    processingDays: rng.int(2, 45),
    feeAmount: rng.int(500, 25000),
    createdAt: isoDate(rng.int(0, 365)),
  }));

  const projectTypes = [
    'Road Upgrade',
    'Park Development',
    'Drainage Upgrade',
    'Public Facility',
    'Streetscape',
  ];
  const stages = ['planning', 'procurement', 'execution', 'handover', 'completed'] as const;
  const contractors = ['QBuild', 'Doha Infra', 'Gulf Works', 'Urban Qatar', 'Municipal Solutions'];

  const projects = Array.from({ length: 140 }, (_, i) => ({
    _id: `prj_${i + 1}`,
    tenantId,
    name: `Municipal Project ${i + 1}`,
    municipality: rng.pick(municipalities),
    projectType: rng.pick(projectTypes),
    stage: rng.pick([...stages]),
    contractor: rng.pick(contractors),
    budgetAmount: rng.int(100_000, 8_000_000),
    completionPercent: rng.int(0, 100),
    createdAt: isoDate(rng.int(0, 540)),
  }));

  return {
    service_requests: serviceRequests,
    inspections,
    permits,
    projects,
  };
}

export function getLocalSampleCollection(collection: string, tenantId: string) {
  const collections = generateSampleCollections(tenantId);
  return collections[collection as SampleCollectionName] ?? [];
}
