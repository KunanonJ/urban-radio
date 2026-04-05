import { PageHeader } from '@/components/shared/page-header';

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of your station operations"
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Total Tracks</p>
          <p className="text-2xl font-bold">--</p>
        </div>
        <div className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Active Campaigns</p>
          <p className="text-2xl font-bold">--</p>
        </div>
        <div className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Today&apos;s Rundown</p>
          <p className="text-2xl font-bold">--</p>
        </div>
        <div className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Fulfillment Rate</p>
          <p className="text-2xl font-bold">--</p>
        </div>
      </div>
    </div>
  );
}
