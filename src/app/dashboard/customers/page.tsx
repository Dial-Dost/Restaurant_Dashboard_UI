
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const customers = [
  {
    name: "Liam Johnson",
    email: "liam@example.com",
    phone: "555-0101",
    totalBookings: 5,
    status: "In-house",
  },
  {
    name: "Olivia Smith",
    email: "olivia@example.com",
    phone: "555-0102",
    totalBookings: 2,
    status: "Departed",
  },
  {
    name: "Noah Williams",
    email: "noah@example.com",
    phone: "555-0103",
    totalBookings: 8,
    status: "In-house",
  },
  {
    name: "Emma Brown",
    email: "emma@example.com",
    phone: "555-0104",
    totalBookings: 1,
    status: "Departed",
  },
  {
    name: "James Jones",
    email: "james@example.com",
    phone: "555-0105",
    totalBookings: 12,
    status: "In-house",
  },
    {
    name: "Sophia Garcia",
    email: "sophia@example.com",
    phone: "555-0106",
    totalBookings: 3,
    status: "Departed",
  },
  {
    name: "Logan Miller",
    email: "logan@example.com",
    phone: "555-0107",
    totalBookings: 7,
    status: "In-house",
  },
];

export default function CustomersPage() {
  return (
    <div className="grid gap-4 md:gap-8">
       <div className="flex items-center justify-between">
         <h1 className="text-lg font-semibold md:text-2xl">Customers</h1>
         <Button>Add Customer</Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Customer List</CardTitle>
          <CardDescription>
            A list of all customers who have made bookings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell text-center">Total Bookings</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.email}>
                  <TableCell className="font-medium">
                    <div>{customer.name}</div>
                    <div className="text-sm text-muted-foreground md:hidden">{customer.email}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-center">{customer.totalBookings}</TableCell>
                  <TableCell>
                    <Badge variant={customer.status === "In-house" ? "default" : "secondary"}>
                      {customer.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
