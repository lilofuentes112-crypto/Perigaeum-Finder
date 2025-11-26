codeTypeScript
export interface PerigeeEvent {
  date: string;
  distanceKm: string;
  distanceAu: number;
  zodiac: string;
}
export interface PerigeeData {
  planetName: string;
  events: PerigeeEvent[];
  description: string;
}

