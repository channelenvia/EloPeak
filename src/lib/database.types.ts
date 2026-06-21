export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          role: 'customer' | 'booster' | 'admin' | 'support'
          username: string
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          role?: 'customer' | 'booster' | 'admin' | 'support'
          username: string
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          email?: string
          role?: 'customer' | 'booster' | 'admin' | 'support'
          username?: string
          avatar_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      customer_profiles: {
        Row: {
          id: string
          user_id: string
          display_name: string | null
          country: string | null
          preferred_language: string | null
          total_orders: number
          total_spent: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          display_name?: string | null
          country?: string | null
          preferred_language?: string | null
          total_orders?: number
          total_spent?: number
          created_at?: string
        }
        Update: {
          display_name?: string | null
          country?: string | null
          preferred_language?: string | null
          total_orders?: number
          total_spent?: number
        }
        Relationships: [
          {
            foreignKeyName: 'customer_profiles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      booster_profiles: {
        Row: {
          id: string
          user_id: string
          display_name: string
          status: 'pending' | 'under_review' | 'approved' | 'suspended' | 'rejected'
          bio: string | null
          peak_rank: Json | null
          current_rank: Json | null
          games: string[]
          queue_preferences: string[]
          region_preferences: string[]
          total_completed: number
          total_earnings: number
          rating: number
          rating_count: number
          is_available: boolean
          is_top5: boolean
          verified_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          display_name: string
          status?: 'pending' | 'under_review' | 'approved' | 'suspended' | 'rejected'
          bio?: string | null
          peak_rank?: Json | null
          current_rank?: Json | null
          games?: string[]
          queue_preferences?: string[]
          region_preferences?: string[]
          total_completed?: number
          total_earnings?: number
          rating?: number
          rating_count?: number
          is_available?: boolean
          is_top5?: boolean
          verified_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string
          status?: 'pending' | 'under_review' | 'approved' | 'suspended' | 'rejected'
          bio?: string | null
          peak_rank?: Json | null
          current_rank?: Json | null
          games?: string[]
          queue_preferences?: string[]
          region_preferences?: string[]
          total_completed?: number
          total_earnings?: number
          rating?: number
          rating_count?: number
          is_available?: boolean
          is_top5?: boolean
          verified_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'booster_profiles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      games: {
        Row: {
          id: string
          slug: 'lol' | 'valorant' | 'tft'
          name: string
          icon_url: string | null
          is_active: boolean
          sort_order: number
        }
        Insert: {
          id?: string
          slug: 'lol' | 'valorant' | 'tft'
          name: string
          icon_url?: string | null
          is_active?: boolean
          sort_order?: number
        }
        Update: {
          slug?: 'lol' | 'valorant' | 'tft'
          name?: string
          icon_url?: string | null
          is_active?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      services: {
        Row: {
          id: string
          game_id: string
          type: 'elo_boost' | 'win_boost' | 'coaching' | 'placement_matches' | 'md5'
          name: string
          description: string | null
          short_description: string | null
          is_active: boolean
          sort_order: number
        }
        Insert: {
          id?: string
          game_id: string
          type: 'elo_boost' | 'win_boost' | 'coaching' | 'placement_matches' | 'md5'
          name: string
          description?: string | null
          short_description?: string | null
          is_active?: boolean
          sort_order?: number
        }
        Update: {
          game_id?: string
          type?: 'elo_boost' | 'win_boost' | 'coaching' | 'placement_matches' | 'md5'
          name?: string
          description?: string | null
          short_description?: string | null
          is_active?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      service_extras: {
        Row: {
          id: string
          service_id: string | null
          name: string
          description: string
          price_modifier: number
          price_modifier_pct: number
          is_active: boolean
          sort_order: number
          icon: string | null
        }
        Insert: {
          id?: string
          service_id?: string | null
          name: string
          description: string
          price_modifier?: number
          price_modifier_pct?: number
          is_active?: boolean
          sort_order?: number
          icon?: string | null
        }
        Update: {
          service_id?: string | null
          name?: string
          description?: string
          price_modifier?: number
          price_modifier_pct?: number
          is_active?: boolean
          sort_order?: number
          icon?: string | null
        }
        Relationships: []
      }
      order_drop_requests: {
        Row: {
          id: string
          order_id: string
          booster_id: string
          reason: string
          wins_at_request: number
          losses_at_request: number
          penalty_pct: number
          penalty_amount: number
          status: 'pending' | 'approved' | 'rejected'
          admin_id: string | null
          admin_note: string | null
          created_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          order_id: string
          booster_id: string
          reason: string
          wins_at_request?: number
          losses_at_request?: number
          penalty_pct?: number
          penalty_amount?: number
          status?: 'pending' | 'approved' | 'rejected'
          admin_id?: string | null
          admin_note?: string | null
          created_at?: string
          resolved_at?: string | null
        }
        Update: {
          status?: 'pending' | 'approved' | 'rejected'
          admin_id?: string | null
          admin_note?: string | null
          resolved_at?: string | null
        }
        Relationships: []
      }
      orders: {
        Row: {
          id: string
          customer_id: string
          service_id: string
          game_id: string
          status: 'draft' | 'awaiting_payment' | 'paid' | 'awaiting_assignment' | 'assigned' | 'in_progress' | 'paused' | 'drop_requested' | 'awaiting_customer' | 'completed' | 'disputed' | 'refunded' | 'canceled'
          queue_type: 'solo_duo' | 'flex'
          boost_mode: 'solo' | 'duo'
          server: string
          current_rank: Json
          target_rank: Json | null
          wins_purchased: number | null
          sessions_purchased: number | null
          extras: Json
          base_price: number
          extras_price: number
          total_price: number
          estimated_hours: number | null
          customer_notes: string | null
          booster_notes: string | null
          wins_played: number
          losses_played: number
          assigned_booster_id: string | null
          mp_payment_id: string | null
          payment_status: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed' | null
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          customer_id: string
          service_id: string
          game_id: string
          status?: 'draft' | 'awaiting_payment' | 'paid' | 'awaiting_assignment' | 'assigned' | 'in_progress' | 'paused' | 'drop_requested' | 'awaiting_customer' | 'completed' | 'disputed' | 'refunded' | 'canceled'
          queue_type: 'solo_duo' | 'flex'
          boost_mode?: 'solo' | 'duo'
          server: string
          current_rank: Json
          target_rank?: Json | null
          wins_purchased?: number | null
          sessions_purchased?: number | null
          extras?: Json
          base_price: number
          extras_price?: number
          total_price: number
          estimated_hours?: number | null
          customer_notes?: string | null
          booster_notes?: string | null
          wins_played?: number
          losses_played?: number
          assigned_booster_id?: string | null
          mp_payment_id?: string | null
          payment_status?: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed' | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: 'draft' | 'awaiting_payment' | 'paid' | 'awaiting_assignment' | 'assigned' | 'in_progress' | 'paused' | 'drop_requested' | 'awaiting_customer' | 'completed' | 'disputed' | 'refunded' | 'canceled'
          queue_type?: 'solo_duo' | 'flex'
          boost_mode?: 'solo' | 'duo'
          server?: string
          current_rank?: Json
          target_rank?: Json | null
          wins_purchased?: number | null
          sessions_purchased?: number | null
          extras?: Json
          base_price?: number
          extras_price?: number
          total_price?: number
          estimated_hours?: number | null
          customer_notes?: string | null
          booster_notes?: string | null
          wins_played?: number
          losses_played?: number
          assigned_booster_id?: string | null
          mp_payment_id?: string | null
          payment_status?: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed' | null
          completed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'orders_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      order_status_history: {
        Row: {
          id: string
          order_id: string
          from_status: 'draft' | 'awaiting_payment' | 'paid' | 'awaiting_assignment' | 'assigned' | 'in_progress' | 'paused' | 'drop_requested' | 'awaiting_customer' | 'completed' | 'disputed' | 'refunded' | 'canceled' | null
          to_status: 'draft' | 'awaiting_payment' | 'paid' | 'awaiting_assignment' | 'assigned' | 'in_progress' | 'paused' | 'drop_requested' | 'awaiting_customer' | 'completed' | 'disputed' | 'refunded' | 'canceled'
          changed_by: string
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          from_status?: 'draft' | 'awaiting_payment' | 'paid' | 'awaiting_assignment' | 'assigned' | 'in_progress' | 'paused' | 'drop_requested' | 'awaiting_customer' | 'completed' | 'disputed' | 'refunded' | 'canceled' | null
          to_status: 'draft' | 'awaiting_payment' | 'paid' | 'awaiting_assignment' | 'assigned' | 'in_progress' | 'paused' | 'drop_requested' | 'awaiting_customer' | 'completed' | 'disputed' | 'refunded' | 'canceled'
          changed_by: string
          reason?: string | null
          created_at?: string
        }
        Update: {
          from_status?: 'draft' | 'awaiting_payment' | 'paid' | 'awaiting_assignment' | 'assigned' | 'in_progress' | 'paused' | 'drop_requested' | 'awaiting_customer' | 'completed' | 'disputed' | 'refunded' | 'canceled' | null
          to_status?: 'draft' | 'awaiting_payment' | 'paid' | 'awaiting_assignment' | 'assigned' | 'in_progress' | 'paused' | 'drop_requested' | 'awaiting_customer' | 'completed' | 'disputed' | 'refunded' | 'canceled'
          reason?: string | null
        }
        Relationships: []
      }
      order_messages: {
        Row: {
          id: string
          order_id: string
          sender_id: string
          sender_role: 'customer' | 'booster' | 'admin' | 'support'
          content: string
          attachment_url: string | null
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          sender_id: string
          sender_role: 'customer' | 'booster' | 'admin' | 'support'
          content: string
          attachment_url?: string | null
          is_read?: boolean
          created_at?: string
        }
        Update: {
          is_read?: boolean
          content?: string
          attachment_url?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          id: string
          order_id: string
          customer_id: string
          mp_payment_id: string
          amount: number
          currency: string
          status: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed'
          payment_method_type: string | null
          webhook_event_id: string | null
          refunded_amount: number
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          order_id: string
          customer_id: string
          mp_payment_id: string
          amount: number
          currency?: string
          status?: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed'
          payment_method_type?: string | null
          webhook_event_id?: string | null
          refunded_amount?: number
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed'
          payment_method_type?: string | null
          webhook_event_id?: string | null
          refunded_amount?: number
          metadata?: Json
          updated_at?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          id: string
          payment_id: string
          order_id: string
          mp_refund_id: string
          amount: number
          reason: string
          initiated_by: string
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          payment_id: string
          order_id: string
          mp_refund_id: string
          amount: number
          reason: string
          initiated_by: string
          status?: string
          created_at?: string
        }
        Update: {
          status?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          id: string
          customer_id: string
          order_id: string | null
          assigned_to: string | null
          status: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'
          priority: 'low' | 'medium' | 'high' | 'urgent'
          subject: string
          created_at: string
          updated_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          customer_id: string
          order_id?: string | null
          assigned_to?: string | null
          status?: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'
          priority?: 'low' | 'medium' | 'high' | 'urgent'
          subject: string
          created_at?: string
          updated_at?: string
          resolved_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          status?: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'
          priority?: 'low' | 'medium' | 'high' | 'urgent'
          subject?: string
          updated_at?: string
          resolved_at?: string | null
        }
        Relationships: []
      }
      ticket_messages: {
        Row: {
          id: string
          ticket_id: string
          sender_id: string
          sender_role: 'customer' | 'booster' | 'admin' | 'support'
          content: string
          is_internal: boolean
          attachment_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          ticket_id: string
          sender_id: string
          sender_role: 'customer' | 'booster' | 'admin' | 'support'
          content: string
          is_internal?: boolean
          attachment_url?: string | null
          created_at?: string
        }
        Update: {
          content?: string
          is_internal?: boolean
          attachment_url?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          id: string
          order_id: string
          customer_id: string
          booster_id: string | null
          rating: number
          content: string | null
          is_public: boolean
          is_moderated: boolean
          admin_note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          customer_id: string
          booster_id?: string | null
          rating: number
          content?: string | null
          is_public?: boolean
          is_moderated?: boolean
          admin_note?: string | null
          created_at?: string
        }
        Update: {
          booster_id?: string | null
          rating?: number
          content?: string | null
          is_public?: boolean
          is_moderated?: boolean
          admin_note?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          body: string
          data: Json
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          title: string
          body: string
          data?: Json
          is_read?: boolean
          created_at?: string
        }
        Update: {
          is_read?: boolean
          data?: Json
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          id: string
          actor_id: string
          actor_role: 'customer' | 'booster' | 'admin' | 'support'
          action: string
          entity_type: string
          entity_id: string
          diff: Json | null
          ip_address: string | null
          created_at: string
        }
        Insert: {
          id?: string
          actor_id: string
          actor_role: 'customer' | 'booster' | 'admin' | 'support'
          action: string
          entity_type: string
          entity_id: string
          diff?: Json | null
          ip_address?: string | null
          created_at?: string
        }
        Update: {
          diff?: Json | null
        }
        Relationships: []
      }
      payout_records: {
        Row: {
          id: string
          booster_id: string
          order_id: string
          gross_amount: number
          commission_rate: number
          commission_amount: number
          net_amount: number
          status: 'pending' | 'processing' | 'paid' | 'failed'
          paid_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          booster_id: string
          order_id: string
          gross_amount: number
          commission_rate?: number
          commission_amount: number
          net_amount: number
          status?: 'pending' | 'processing' | 'paid' | 'failed'
          paid_at?: string | null
          created_at?: string
        }
        Update: {
          status?: 'pending' | 'processing' | 'paid' | 'failed'
          paid_at?: string | null
        }
        Relationships: []
      }
      booster_applications: {
        Row: {
          id: string
          created_at: string
          updated_at: string
          user_id: string | null
          summoner_name: string
          opgg_link: string | null
          region: string
          peak_rank: string
          roles: string[]
          games: string[]
          has_coaching: boolean
          available_days: string[]
          hours_per_week: number
          years_experience: number
          discord_tag: string | null
          motivation: string
          status: 'pending' | 'under_review' | 'accepted' | 'rejected'
          admin_notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          updated_at?: string
          user_id?: string | null
          summoner_name: string
          opgg_link?: string | null
          region: string
          peak_rank: string
          roles?: string[]
          games?: string[]
          has_coaching?: boolean
          available_days?: string[]
          hours_per_week: number
          years_experience: number
          discord_tag?: string | null
          motivation: string
          status?: 'pending' | 'under_review' | 'accepted' | 'rejected'
          admin_notes?: string | null
        }
        Update: {
          user_id?: string | null
          summoner_name?: string
          opgg_link?: string | null
          region?: string
          peak_rank?: string
          roles?: string[]
          games?: string[]
          has_coaching?: boolean
          available_days?: string[]
          hours_per_week?: number
          years_experience?: number
          discord_tag?: string | null
          motivation?: string
          status?: 'pending' | 'under_review' | 'accepted' | 'rejected'
          admin_notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_boost_order: {
        Args: { p_order_id: string; p_booster_user_id: string }
        Returns: Json
      }
      can_booster_accept_order: {
        Args: { p_booster_user_id: string; p_boost_mode: string }
        Returns: Json
      }
      booster_active_slot_counts: {
        Args: { p_booster_user_id: string }
        Returns: { solo_count: number; duo_count: number; total_count: number }[]
      }
      refresh_top5_boosters: {
        Args: Record<string, never>
        Returns: undefined
      }
      ensure_profile_exists: {
        Args: { p_display_name: string | null }
        Returns: Json
      }
      approve_booster: {
        Args: { p_booster_id: string; p_new_status: string }
        Returns: Json
      }
      toggle_booster_top5: {
        Args: { p_booster_id: string; p_is_top5: boolean }
        Returns: Json
      }
      resolve_drop_request: {
        Args: { p_request_id: string; p_approve: boolean; p_admin_note: string | null }
        Returns: Json
      }
      admin_override_order_status: {
        Args: { p_order_id: string; p_new_status: string }
        Returns: Json
      }
      moderate_review: {
        Args: { p_review_id: string; p_is_public: boolean }
        Returns: Json
      }
      assign_ticket: {
        Args: { p_ticket_id: string }
        Returns: Json
      }
      update_order_status: {
        Args: { p_order_id: string; p_new_status: string }
        Returns: Json
      }
      log_match_result: {
        Args: { p_order_id: string; p_wins: number; p_losses: number }
        Returns: Json
      }
      request_order_drop: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      onboard_booster: {
        Args: {
          p_display_name: string
          p_bio: string
          p_peak_rank: Json | null
          p_opgg_link: string | null
          p_hours_per_day_min: number | null
          p_hours_per_day_max: number | null
          p_full_name: string
          p_cpf: string
        }
        Returns: Json
      }
      update_my_username: {
        Args: { p_username: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
