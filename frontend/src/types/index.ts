export interface Tenant {
  id: string;
  name: string;
  prompt_directions?: string;
  media_library?: Record<string, any>;
}

export interface Session {
  id: string;
  customer_phone: string;
  status: 'WAITING_FOR_BOT' | 'AGENT_RESPONDING' | 'RESOLVED' | 'NEEDS_HUMAN';
  tenant_id: string | null;
  updated_at: string;
}

export interface Message {
  id: string;          // WhatsApp message ID (wamid...)
  session_id: string;
  direction: 'inbound' | 'outbound';
  content_type: 'text' | 'image' | 'document';
  text_content: string | null;
  media_url: string | null;
  timestamp: string;   // DB column is 'timestamp', not 'created_at'
}
