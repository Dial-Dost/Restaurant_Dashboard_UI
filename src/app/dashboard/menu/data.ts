
export type MenuItem = {
  id: string;
  name: string;
  price: number;
  category: string;
};

export const initialMenuItems: MenuItem[] = [
  { id: "1", name: "Garlic Bread", price: 6.5, category: "Appetizers" },
  { id: "2", name: "Bruschetta", price: 8.0, category: "Appetizers" },
  { id: "3", name: "Margherita Pizza", price: 14.0, category: "Main Courses" },
  { id: "4", name: "Spaghetti Carbonara", price: 16.5, category: "Main Courses" },
  { id: "5", name: "Tiramisu", price: 7.0, category: "Desserts" },
  { id: "6", name: "Panna Cotta", price: 7.0, category: "Desserts" },
  { id: "7", name: "House Red Wine", price: 8.0, category: "Beverages" },
  { id: "8", name: "Sparkling Water", price: 3.0, category: "Beverages" },
];
