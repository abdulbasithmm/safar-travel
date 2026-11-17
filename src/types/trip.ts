export type CurrencyCode = 'INR' | 'USD' | 'EUR';
export type TravelStyle =
  | 'family'
  | 'solo'
  | 'couple'
  | 'adventure'
  | 'budget'
  | 'luxury';
export type TripStatus = 'draft' | 'planned' | 'archived';
export type TripLanguage = 'en' | 'ml';
export type PreferredLanguage = 'auto' | 'en' | 'ml';

export interface BudgetBreakdown {
  accommodation: number;
  food: number;
  transportation: number;
  activities: number;
  total: number;
  currency: CurrencyCode;
  disclaimer: string;
}

export interface ItineraryScheduleItem {
  time: string;
  activity: string;
  location: string;
  visitingHours: string;
  travelTimeFromPrev: string;
  estimatedCost: number;
  notes: string;
}

export interface ItineraryDay {
  day: number;
  date: string;
  theme: string;
  estimatedTravelTime: string;
  schedule: ItineraryScheduleItem[];
}

export interface AttractionItem {
  name: string;
  description: string;
  bestTimeToVisit: string;
  estimatedDuration: string;
}

export interface AccommodationItem {
  name: string;
  area: string;
  tier: string;
  approximateNightlyRange: string;
  notes: string;
}

export interface FoodItem {
  dishOrSpot: string;
  type: string;
  area: string;
  approximateCostRange: string;
  notes: string;
}

export interface StructuredTripPlan {
  destination: string;
  tripSummary: string;
  totalEstimatedBudget: number;
  currency: CurrencyCode;
  budgetBreakdown: BudgetBreakdown;
  dailyItinerary: ItineraryDay[];
  attractions: AttractionItem[];
  accommodationSuggestions: AccommodationItem[];
  foodRecommendations: FoodItem[];
  travelTips: string[];
  suggestedFollowUps: string[];
  language: TripLanguage;
}

export interface TripPlanInput {
  destination: string;
  startingLocation: string;
  departureDate: string;
  returnDate: string;
  travelers: number;
  durationDays: number;
  budgetAmount: number;
  currency: CurrencyCode;
  travelStyle: TravelStyle;
  interests: string[];
  prompt: string;
  language: PreferredLanguage;
}

export interface TripRecord extends StructuredTripPlan {
  id: string;
  ownerId: string;
  title: string;
  prompt: string;
  startingLocation: string;
  departureDate: string;
  returnDate: string;
  travelers: number;
  durationDays: number;
  budgetAmount: number;
  travelStyle: TravelStyle;
  interests: string[];
  notes: string;
  status: TripStatus;
  aiProvider: 'openai';
  responseId?: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}
