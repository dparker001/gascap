/**
 * Client-safe maintenance types and constants.
 * No Node.js imports — safe to use in client components.
 */

export type ServiceType =
  | 'oil_change'
  | 'tire_rotation'
  | 'air_filter'
  | 'cabin_filter'
  | 'brake_inspection'
  | 'coolant_flush'
  | 'transmission_fluid'
  | 'spark_plugs'
  | 'battery'
  | 'wiper_blades'
  | 'custom';

export interface MaintenanceReminder {
  id:               string;
  userId:           string;
  vehicleId?:       string;
  vehicleName:      string;
  serviceType:      ServiceType;
  customLabel?:     string;
  intervalMiles?:   number;
  intervalMonths?:  number;
  lastServiceMiles?: number;
  lastServiceDate?:  string;   // YYYY-MM-DD
  notes?:            string;
  createdAt:         string;
  updatedAt:         string;
}

export type ReminderStatus = 'ok' | 'due_soon' | 'overdue' | 'unknown';

export interface ReminderWithStatus extends MaintenanceReminder {
  status:           ReminderStatus;
  milesUntilDue?:   number;
  daysUntilDue?:    number;
  dueMiles?:        number;
  dueDate?:         string;
}

export const SERVICE_PRESETS: Record<
  ServiceType,
  { label: string; emoji: string; defaultMiles?: number; defaultMonths?: number }
> = {
  oil_change:          { label: 'Oil Change',           emoji: '🛢️',  defaultMiles: 5000,  defaultMonths: 6  },
  tire_rotation:       { label: 'Tire Rotation',        emoji: '🔄',  defaultMiles: 7500,  defaultMonths: 6  },
  air_filter:          { label: 'Air Filter',           emoji: '💨',  defaultMiles: 15000, defaultMonths: 12 },
  cabin_filter:        { label: 'Cabin Air Filter',     emoji: '🌬️',  defaultMiles: 15000, defaultMonths: 12 },
  brake_inspection:    { label: 'Brake Inspection',     emoji: '🛑',  defaultMiles: 20000, defaultMonths: 12 },
  coolant_flush:       { label: 'Coolant Flush',        emoji: '🧊',  defaultMiles: 30000, defaultMonths: 24 },
  transmission_fluid:  { label: 'Transmission Fluid',   emoji: '⚙️',  defaultMiles: 30000, defaultMonths: 24 },
  spark_plugs:         { label: 'Spark Plugs',          emoji: '⚡',  defaultMiles: 30000, defaultMonths: 24 },
  battery:             { label: 'Battery Check',        emoji: '🔋',  defaultMiles: undefined, defaultMonths: 36 },
  wiper_blades:        { label: 'Wiper Blades',         emoji: '🌧️',  defaultMiles: undefined, defaultMonths: 12 },
  custom:              { label: 'Custom Service',       emoji: '🔧',  defaultMiles: undefined, defaultMonths: undefined },
};
