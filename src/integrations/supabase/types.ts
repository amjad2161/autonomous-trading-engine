export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      goal_progress: {
        Row: {
          created_at: string
          goal_id: string | null
          id: string
          notes: string | null
          progress_percentage: number | null
          recorded_value: number
        }
        Insert: {
          created_at?: string
          goal_id?: string | null
          id?: string
          notes?: string | null
          progress_percentage?: number | null
          recorded_value: number
        }
        Update: {
          created_at?: string
          goal_id?: string | null
          id?: string
          notes?: string | null
          progress_percentage?: number | null
          recorded_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "goal_progress_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "trading_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_log: {
        Row: {
          action_taken: string | null
          confidence: number | null
          created_at: string
          expected_edge: number | null
          id: string
          opportunity_type: string
          result: string | null
          symbol: string
        }
        Insert: {
          action_taken?: string | null
          confidence?: number | null
          created_at?: string
          expected_edge?: number | null
          id?: string
          opportunity_type: string
          result?: string | null
          symbol: string
        }
        Update: {
          action_taken?: string | null
          confidence?: number | null
          created_at?: string
          expected_edge?: number | null
          id?: string
          opportunity_type?: string
          result?: string | null
          symbol?: string
        }
        Relationships: []
      }
      rewards_collected: {
        Row: {
          collected_at: string | null
          created_at: string
          details: Json | null
          id: string
          name: string | null
          reward_type: string
          value_usdt: number | null
        }
        Insert: {
          collected_at?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          name?: string | null
          reward_type: string
          value_usdt?: number | null
        }
        Update: {
          collected_at?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          name?: string | null
          reward_type?: string
          value_usdt?: number | null
        }
        Relationships: []
      }
      system_log: {
        Row: {
          component: string
          created_at: string
          details: Json | null
          id: string
          level: string
          message: string
        }
        Insert: {
          component: string
          created_at?: string
          details?: Json | null
          id?: string
          level?: string
          message: string
        }
        Update: {
          component?: string
          created_at?: string
          details?: Json | null
          id?: string
          level?: string
          message?: string
        }
        Relationships: []
      }
      trade_history: {
        Row: {
          actual_pnl: number | null
          amount: number | null
          created_at: string
          error: string | null
          executed_at: string | null
          expected_edge: number | null
          id: string
          order_id: string | null
          price: number | null
          side: string
          status: string
          symbol: string
          type: string
        }
        Insert: {
          actual_pnl?: number | null
          amount?: number | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          expected_edge?: number | null
          id?: string
          order_id?: string | null
          price?: number | null
          side: string
          status?: string
          symbol: string
          type: string
        }
        Update: {
          actual_pnl?: number | null
          amount?: number | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          expected_edge?: number | null
          id?: string
          order_id?: string | null
          price?: number | null
          side?: string
          status?: string
          symbol?: string
          type?: string
        }
        Relationships: []
      }
      trading_goals: {
        Row: {
          achieved_at: string | null
          auto_adjust_aggression: boolean | null
          created_at: string
          current_value: number | null
          deadline: string | null
          goal_type: string
          id: string
          notes: string | null
          priority: number | null
          start_value: number | null
          status: string | null
          target_value: number
          updated_at: string
        }
        Insert: {
          achieved_at?: string | null
          auto_adjust_aggression?: boolean | null
          created_at?: string
          current_value?: number | null
          deadline?: string | null
          goal_type: string
          id?: string
          notes?: string | null
          priority?: number | null
          start_value?: number | null
          status?: string | null
          target_value: number
          updated_at?: string
        }
        Update: {
          achieved_at?: string | null
          auto_adjust_aggression?: boolean | null
          created_at?: string
          current_value?: number | null
          deadline?: string | null
          goal_type?: string
          id?: string
          notes?: string | null
          priority?: number | null
          start_value?: number | null
          status?: string | null
          target_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      trading_system_state: {
        Row: {
          created_at: string
          current_balance: number | null
          id: string
          is_active: boolean
          kill_switch_reset_at: string | null
          last_heartbeat: string | null
          settings: Json | null
          started_at: string | null
          successful_trades: number | null
          total_cycles: number | null
          total_pnl: number | null
          total_trades: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_balance?: number | null
          id?: string
          is_active?: boolean
          kill_switch_reset_at?: string | null
          last_heartbeat?: string | null
          settings?: Json | null
          started_at?: string | null
          successful_trades?: number | null
          total_cycles?: number | null
          total_pnl?: number | null
          total_trades?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_balance?: number | null
          id?: string
          is_active?: boolean
          kill_switch_reset_at?: string | null
          last_heartbeat?: string | null
          settings?: Json | null
          started_at?: string | null
          successful_trades?: number | null
          total_cycles?: number | null
          total_pnl?: number | null
          total_trades?: number | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
