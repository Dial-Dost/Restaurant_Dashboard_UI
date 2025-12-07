
export type Table = {
  id: number;
  name: string;
  capacity: number;
  status: "Available" | "Reserved" | "Booked" | "Occupied";
};
