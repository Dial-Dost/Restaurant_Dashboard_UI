"use client";

import config from "@/context/server";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Users, Armchair, PlusCircle } from "lucide-react";

type Table = {
  id: number;
  name: string;
  capacity: number;
  status: string;
};

type _ServerTable = {
  name: string;
  capacity: number;
  booked: boolean;
};

function convertServerTable(tables: any[]) {
  return tables.map((table, index) => ({
    id: index + 1,
    name: table.table_name,
    capacity: table.capacity,
    status: table.booked ? "Booked" : "Available",
  }));
}

const groupTablesByCapacity = (tables: Table[]) => {
  return tables.reduce(
    (acc, table) => {
      const capacity = table.capacity;
      if (!acc[capacity]) {
        acc[capacity] = [];
      }
      acc[capacity].push(table);
      // Sort tables inside each capacity group by name
      acc[capacity].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
      return acc;
    },
    {} as Record<number, Table[]>,
  );
};

export default function TablesPage() {
  const [tablesData, setTablesData] = useState<Table[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [newTableCapacity, setNewTableCapacity] = useState("");

  async function fetchTables() {
    let response = await fetch(config.server_url + "/get-tables");

    if (!response.ok) {
      console.log("Oops something went wrong with the server");
    }
    const data = await response.json();
    setTablesData(convertServerTable(data));
  }

  useEffect(() => {
    fetchTables();
  }, []);

  const handleAddTable = async () => {
    if (newTableName && newTableCapacity) {
      let new_table = {
        table: {
          name: newTableName,
          capacity: newTableCapacity,
        },
      };

      let response = await fetch(config.server_url + "/add-table", {
        method: "post",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(new_table),
      });

      setIsDialogOpen(false);
      fetchTables()

      return response.ok
    }
  };

  const groupedTables = groupTablesByCapacity(tablesData);
  const sortedCapacities = Object.keys(groupedTables)
    .map(Number)
    .sort((a, b) => a - b);
  const totalTables = tablesData.length;
  const bookedTables = tablesData.filter((t) => t.status === "Booked").length;

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Table Management</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Table
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Table</DialogTitle>
              <DialogDescription>
                Enter the details for the new table. Click save when you're
                done.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                  Table Name
                </Label>
                <Input
                  id="name"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  className="col-span-3"
                  placeholder="e.g., T11"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="capacity" className="text-right">
                  Capacity
                </Label>
                <Input
                  id="capacity"
                  type="number"
                  value={newTableCapacity}
                  onChange={(e) => setNewTableCapacity(e.target.value)}
                  className="col-span-3"
                  placeholder="e.g., 4"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAddTable}>Save changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Table Status Overview</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {bookedTables} of {totalTables} tables are currently booked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-8">
            {sortedCapacities.map((capacity) => (
              <div key={capacity}>
                <h3 className="text-lg font-semibold mb-4 flex items-center md:text-xl">
                  <Users className="mr-2 h-5 w-5" /> {capacity}-Person Tables
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                  {groupedTables[capacity].map((table) => (
                    <Card
                      key={table.id}
                      className={cn(
                        "transition-all hover:shadow-lg",
                        table.status === "Booked"
                          ? "bg-secondary"
                          : "bg-background",
                      )}
                    >
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3">
                        <CardTitle className="text-xs font-medium sm:text-sm">
                          {table.name}
                        </CardTitle>
                        <Armchair className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent className="p-3 pt-0">
                        <Badge
                          variant={
                            table.status === "Booked"
                              ? "destructive"
                              : "default"
                          }
                          className="text-[10px] sm:text-xs"
                        >
                          {table.status}
                        </Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
