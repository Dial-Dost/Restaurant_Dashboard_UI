
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const auditLogs = [
  {
    id: "1",
    employee: "Jane Smith (employee1)",
    action: "Order Create",
    details: "Created order #5 for table T3.",
    timestamp: "2023-10-27T10:00:00Z",
  },
  {
    id: "2",
    employee: "John Doe (admin)",
    action: "Inventory Update",
    details: "Updated 'Tomatoes' stock to 45kg.",
    timestamp: "2023-10-27T10:05:00Z",
  },
  {
    id: "3",
    employee: "Jane Smith (employee1)",
    action: "Booking Confirmed",
    details: "Confirmed booking for Emma Brown.",
    timestamp: "2023-10-27T10:15:00Z",
  },
  {
    id: "4",
    employee: "John Doe (admin)",
    action: "User Login",
    details: "Admin user logged in.",
    timestamp: "2023-10-27T09:58:00Z",
  },
   {
    id: "5",
    employee: "Jane Smith (employee1)",
    action: "Order Status Update",
    details: "Order #4 status changed to 'Served'.",
    timestamp: "2023-10-27T10:20:00Z",
  },
];

export default function AuditLogsPage() {
  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Audit Logs</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Activity History</CardTitle>
          <CardDescription>
            A log of all actions performed by employees in the system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>
                    {new Date(log.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium">{log.employee}</TableCell>
                   <TableCell>
                    <Badge variant="secondary">{log.action}</Badge>
                   </TableCell>
                  <TableCell>{log.details}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
