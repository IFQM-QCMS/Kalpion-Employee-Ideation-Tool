# Kalpion — Technical & Deployment Documentation
**Version:** 1.0 (Mark-1) | **Generated:** 2026-05-28

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [How the Application Works — Layman's Guide](#2-how-the-application-works--laymans-guide)
3. [Technical Architecture Deep Dive](#3-technical-architecture-deep-dive)
4. [Complete Process Flow](#4-complete-process-flow)
5. [Multi-Tenant Architecture](#5-multi-tenant-architecture)
6. [Scaling Strategy & Projections](#6-scaling-strategy--projections)
7. [Database Decisions: SQL vs NoSQL](#7-database-decisions-sql-vs-nosql)
8. [Deployment Architecture](#8-deployment-architecture)
9. [Cost Projections](#9-cost-projections)
10. [Recommendations for IFQM](#10-recommendations-for-ifqm)

---

## 1. Executive Summary

**Kalpion** is a multi-tenant web application that enables organizations (particularly MSMEs) to collect, evaluate, and manage employee ideas for process improvement and innovation.

**Current Status:**
- Fully functional PHP/MySQL application
- Single-server deployment (XAMPP)
- Supports 7 Indian languages
- 18 Features implemented
- Ready for production deployment

**IFQM's Vision:**
Hand over this platform to hundreds of MSMEs, each potentially serving 1,000+ users under a single tenant organization.

---

## 2. How the Application Works — Layman's Guide

### What is IFQM?

Think of IFQM as a **digital suggestion box on steroids**. Instead of dropping paper slips into a box, employees submit ideas through a beautiful website. But it doesn't just collect ideas — it:

1. **Scores them automatically** using AI (like a smart teacher grading papers)
2. **Routes them to the right people** for review (like a conveyor belt)
3. **Tracks their progress** (like a delivery tracking system)
4. **Rewards good ideas** with points (like a loyalty program)
5. **Measures impact** with ROI tracking

### The Simple Flow (User Perspective)

```
User opens website → Sees login page → Enters email/password →
→ Lands on dashboard → Sees ideas from colleagues →
→ Can submit own idea (5-step form) → AI scores it instantly →
→ Idea goes to reviewers → Gets approved/rejected →
→ If approved, gets implemented → User earns points
```

### Key Roles in the System

| Role | What They Do |
|------|-------------|
| **Employee/Trainee** | Submit ideas, vote on others' ideas, comment |
| **Team Lead/Project Lead** | Review ideas from their team |
| **Manager** | Approve/reject ideas, view department analytics |
| **Senior Manager/Executive** | Final approval authority, company-wide view |
| **Admin** | Manage users, settings, organization configuration |
| **Super Admin** | Can access everything, manage multiple tenants |

### The 9-Role Hierarchy

```
                    ┌─────────────┐
                    │  Super Admin │  ← Can do everything
                    └──────┬──────┘
                           │
                 ┌─────────┼─────────┐
                 ▼         ▼         ▼
           ┌────────┐ ┌────────┐ ┌──────────┐
           │ Admin  │ │Executive│ │Sr Manager│
           └────┬───┘ └────┬───┘ └────┬─────┘
                │         │         │
                ▼         └────┬────┘
           ┌────────┐         ▼
           │Manager │    ┌──────────┐
           └───┬────┘    │Project   │
               │         │Lead      │
               └────┬────┘────┬─────┘
                    ▼         ▼
               ┌────────┐ ┌──────────┐
               │TeamLead│ │Employee  │
               └───┬────┘ └────┬─────┘
                   │           │
                   ▼           ▼
               ┌────────────────┐
               │    Trainee     │
               └────────────────┘
```

---

## 3. Technical Architecture Deep Dive

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | Vanilla HTML/CSS/JS | Single Page Application in index.php |
| **Backend** | PHP 8.x | RESTful API endpoints |
| **Database** | MySQL 8.0 / MariaDB | Relational data storage |
| **Web Server** | Apache 2.4 | HTTP server |
| **Session Mgmt** | PHP Sessions | User authentication |
| **Email** | Raw SMTP | Transactional emails |

### Application Structure

```
ifqm/
├── index.php              # Main SPA (Single Page Application)
├── api/                   # REST API endpoints
│   ├── config.php         # Database connections, helpers
│   ├── auth.php           # Login, logout, password reset
│   ├── ideas.php          # Idea CRUD, submission, review
│   ├── votes.php          # 5-star ratings & upvote/downvote
│   ├── comments.php       # Discussion threads
│   ├── users.php          # User management, leaderboard
│   ├── challenges.php     # Innovation challenges
│   ├── settings.php       # Organization settings
│   ├── score.php          # AI scoring engine
│   ├── mailer.php         # Email queue & SMTP sending
│   ├── upload.php         # File attachments
│   ├── export.php         # CSV/HTML reports
│   └── platform.php       # Multi-tenant admin (IFQM staff)
├── database.sql           # Schema with seed data
├── schema.sql             # Schema template (no seed)
├── schema_updates.sql     # Feature additions
└── assets/                # Images, logos, etc.
```

### Database Architecture

**3-Tier Architecture:**
```
┌─────────────────────────────────────┐
│         ifqm_master (Master DB)     │
│  - Platform admins                 │
│  - Tenant registry                  │
│  - Cross-tenant analytics           │
└─────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌─────────────────┐   ┌─────────────────┐
│ ifqm_ideation   │   │  ifqm_jain_uni  │
│ (Tenant: IFQM)  │   │  (Tenant: Jain) │
│ - Users         │   │  - Users        │
│ - Ideas         │   │  - Ideas        │
│ - Votes         │   │  - Votes        │
│ - Workflow      │   │  - Workflow     │
│ - Comments      │   │  - Comments     │
│ - Challenges    │   │  - Challenges   │
└─────────────────┘   └─────────────────┘
```

### Key Tables and Their Purposes

| Table | Purpose |
|-------|---------|
| **users** | Employee records, roles, permissions |
| **ideas** | Main idea submissions with all details |
| **idea_votes** | 5-star ratings (1-5 scale) |
| **idea_community_votes** | Upvote/downvote system |
| **idea_reviewers** | Multi-reviewer workflow assignments |
| **idea_workflow** | Audit trail of all actions |
| **idea_comments** | Discussion threads (with replies) |
| **challenges** | Innovation challenges with deadlines |
| **notifications** | User notification messages |
| **org_settings** | Organization configuration |
| **email_queue** | Pending emails to send |
| **password_reset_tokens** | Secure password reset tokens |

---

## 4. Complete Process Flow

### 4.1 User Opens the Website

```
User types: www.ifqm.com or clicks link
        │
        ▼
┌─────────────────┐
│  Apache Web     │  Receives request
│    Server       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  index.php      │  Loads main application
│  (Single Page)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ JavaScript      │  Checks: "Is user logged in?"
│  runs in browser│
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
  YES        NO
    │         │
    ▼         ▼
 ┌──────┐  ┌─────────────┐
 │Dashboard│ │ Login Page  │
 │ loaded │  │  displayed │
 └──────┘  └─────────────┘
```

### 4.2 Login Flow (Detailed)

```
┌─────────────────────────────────────────────────────────────┐
│                      LOGIN SEQUENCE                         │
└─────────────────────────────────────────────────────────────┘

1. User sees login page with:
   - Email input field
   - Password input field
   - "Forgot Password?" link
   - Organization selector (if multi-tenant)

2. User enters: email@example.com + password

3. JavaScript sends AJAX request:
   POST /api/auth.php?action=login
   {
     "email": "email@example.com",
     "password": "userpassword123"
   }

4. Server receives request (auth.php):
   │
   ├─► Check brute-force protection
   │   (5 failed attempts = 15 min lockout)
   │
   ├─► Try platform admin first (IFQM staff)
   │   Check ifqm_master.platform_admins table
   │
   └─► If not platform admin:
       Check tenant's users table
       (password verified with bcrypt)

5. If password matches:
   - Generate CSRF token (security)
   - Store user session (PHP session)
   - Return user data + token

6. Browser receives:
   {
     "success": true,
     "user": { id, name, role, department, ... },
     "csrf_token": "abc123..."
   }

7. JavaScript:
   - Store token in memory
   - Load dashboard with user's ideas
   - Show user profile in sidebar
```

### 4.3 Submitting an Idea (5-Step Wizard)

```
┌─────────────────────────────────────────────────────────────┐
│                    IDEA SUBMISSION FLOW                     │
└─────────────────────────────────────────────────────────────┘

STEP 1: Basic Information
┌────────────────────────────────────────────┐
│ Title: "Improve Customer Response Time"    │
│ Impact Level: [High ▼]                     │
│ Impact Areas: [x] Operations [x] Quality   │
└────────────────────────────────────────────┘
            │
            ▼ (Next)
STEP 2: Present Situation
┌────────────────────────────────────────────┐
│ "Currently, customer queries take 48hrs   │
│  to resolve because of manual routing..."  │
└────────────────────────────────────────────┘
            │
            ▼ (Next)
STEP 3: Proposed Solution
┌────────────────────────────────────────────┐
│ "Implement AI-based ticket routing with    │
│  automatic priority classification..."     │
└────────────────────────────────────────────┘
            │
            ▼ (Next)
STEP 4: Benefits
┌────────────────────────────────────────────┐
│ Tangible: "Reduce response time to 4hrs"   │
│ Intangible: "Better customer satisfaction" │
└────────────────────────────────────────────┘
            │
            ▼ (Next)
STEP 5: Attachments & Submit
┌────────────────────────────────────────────┐
│ [Upload supporting documents/images]        │
│                        [Submit Idea]        │
└────────────────────────────────────────────┘

AFTER SUBMISSION:
1. Generate unique idea code: IDA-2026-003
2. Calculate AI score (0-100)
3. Assign initial status: "Submitted"
4. Add to workflow log
5. Award 10 points to submitter
6. Send notification to reviewers
7. Display success with AI score
```

### 4.4 AI Scoring Engine Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    AI SCORING PROCESS                        │
└─────────────────────────────────────────────────────────────┘

IDEAS.PHP receives submission
        │
        ▼
SCORE.PHP calculates heuristic score (instant):
        │
        ├──► Title quality (0-15 points)
        ├──► Problem clarity (0-20 points)
        ├──► Solution detail (0-25 points)
        ├──► Impact quantification (0-20 points)
        ├──► Feasibility factors (0-10 points)
        └──► Feasibility factors (0-10 points)
                │
                ▼
        Heuristic Score: 0-100

        If GEMINI_API_KEY configured:
                │
                ▼
        CALL TO GOOGLE GEMINI API
        (async, non-blocking)
                │
                ▼
        AI provides:
        - Numeric score
        - Text reasoning
        - Improvement suggestions

Result stored in ideas table:
- ai_score: 33 (or higher from AI)
- ai_reason: "Strong business impact..."
```

### 4.5 Idea Review & Approval Workflow

```
┌─────────────────────────────────────────────────────────────┐
│              HIERARCHICAL APPROVAL WORKFLOW                  │
└─────────────────────────────────────────────────────────────┘

IDEA SUBMITTED (Score: 33, Status: Submitted)
        │
        ▼
┌─────────────────────────────────────┐
│ Manager receives notification        │
│ Reviews idea details                 │
│ Can: Approve / Reject / Request Info │
└─────────────────────────────────────┘
        │
   ┌────┴────┐
   │         │
Approved   Rejected
   │         │
   ▼         ▼
┌────────┐ ┌────────────┐
│Executive│ │ Submitter  │
│  Review │ │ notified   │
└────────┘ └────────────┘
   │
   │ (If needed)
   ▼
┌────────────┐
│ Final      │
│ Approval   │ (Status: Approved)
└────────────┘
   │
   ▼
┌─────────────────────────┐
│ Implementation Phase   │
│ - Assign owner          │
│ - Set target date       │
│ - Track progress        │
└─────────────────────────┘
   │
   ▼
┌─────────────────────────┐
│ Mark as "Implemented"  │
│ Award additional points │
│ (Status: Implemented)   │
└─────────────────────────┘
```

### 4.6 Multi-Reviewer Workflow

```
┌─────────────────────────────────────────────────────────────┐
│              MULTI-REVIEWER APPROVAL FLOW                   │
└─────────────────────────────────────────────────────────────┘

Submitter creates idea with workflow_type = "multi_reviewer"

Admin assigns multiple reviewers:
┌──────────────────────────────────────┐
│ Reviewer 1: Team Lead (John)         │
│ Reviewer 2: Manager (Sarah)           │
│ Reviewer 3: Senior Manager (Mike)    │
└──────────────────────────────────────┘

Each reviewer independently:
- Reviews the idea
- Gives decision: Approve/Reject
- Adds comments

System tracks:
┌─────────────────────────────────────────────────┐
│ Reviewer 1: Approved ✓                          │
│ Reviewer 2: Approved ✓                          │
│ Reviewer 3: Pending  ○                          │
└─────────────────────────────────────────────────┘

If ALL approve → Status becomes "Approved"
If 2+ reject → Status becomes "Rejected"
```

### 4.7 Voting System

```
┌─────────────────────────────────────────────────────────────┐
│                    COMMUNITY VOTING                          │
└─────────────────────────────────────────────────────────────┘

5-STAR RATING (Quality Scale):
┌────────────────────────────────────────┐
│ ★ ★ ★ ★ ☆  (4 out of 5 stars)          │
│ Average: 4.2 | Total votes: 47         │
└────────────────────────────────────────┘
- Users rate ideas 1-5 stars
- Average rating displayed
- Cannot vote on own ideas

UPVOTE/DOWNVOTE (Popularity Scale):
┌────────────────────────────────────────┐
│ 👍 127  │  👎 23  │  Net: +104         │
└────────────────────────────────────────┘
- Click upvote → +1 to idea's upvotes
- Click again → Removes vote (toggle)
- Click downvote → Switches from up to down

Community-adjusted score:
AI Score + (net_votes × 3)
Example: AI Score 50 + (10 upvotes - 3 downvotes) × 3
       = 50 + 21 = 71
```

### 4.8 Password Reset Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   PASSWORD RESET FLOW                        │
└─────────────────────────────────────────────────────────────┘

1. User clicks "Forgot Password"

2. Enter email: user@example.com

3. Server (auth.php?action=forgot_password):
   - Check if email exists
   - Generate 64-character secure token
   - Hash token with bcrypt
   - Store in password_reset_tokens table
   - (Expires in 1 hour)

4. Send email via SMTP:
   Subject: "Reset Your IFQM Password"
   Button: "Reset Password" → links to:
   http://app.ifqm.com/index.php?reset_token=abc123...

5. User clicks link

6. Server validates token (auth.php?action=check_reset_token):
   - Check if token hash matches
   - Check if not expired

7. User enters new password

8. Server updates password_hash
   - Deletes used token (single-use)
   - User can now login
```

---

## 5. Multi-Tenant Architecture

### What is Multi-Tenancy?

One application serves multiple organizations (tenants), each with:
- **Separate database** (data isolation)
- **Custom branding** (primary_color per tenant)
- **Independent settings**
- **Own users and ideas**

```
┌─────────────────────────────────────────────────────────────┐
│                    IFQM PLATFORM                             │
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────┐   │
│  │ MSME #1  │   │ MSME #2  │   │ MSME #3  │   │  ...   │   │
│  │ Jain Uni │   │ ABC Corp │   │ XYZ Ltd  │   │  N     │   │
│  │          │   │          │   │          │   │        │   │
│  │ 500 users│   │ 1200 users│  │ 800 users│   │        │   │
│  │ 150 ideas│   │ 300 ideas│   │ 200 ideas│   │        │   │
│  └──────────┘   └──────────┘   └──────────┘   └────────┘   │
│                                                             │
│  Tenant Registry (ifqm_master.tenants table)               │
└─────────────────────────────────────────────────────────────┘
```

### Tenant Resolution Priority

When a user accesses the system:

```
1. Check session (already logged in with org_slug)
      │
      ├─► Found: Use that tenant's database
      │
      └─► Not found: Check URL parameter ?org=msme_slug
                        │
                        ├─► Found: Use that tenant's database
                        │
                        └─► Not found: Check domain name
                                       (e.g., jain.ifqm.com)
                                          │
                                          ├─► Found: Use tenant
                                          │
                                          └─► Not found: Use default
```

### Creating a New Tenant (Admin Flow)

```
IFQM Admin creates new tenant via platform.php:
        │
        ▼
1. Create new MySQL database: ifqm_msme_123
        │
        ▼
2. Run schema.sql to create tables
        │
        ▼
3. Create first admin user
        │
        ▼
4. Register tenant in ifqm_master.tenants:
   - name: "ABC Corporation"
   - slug: "abc-corp"
   - domain: "abc.ifqm.com"
   - db_host, db_name, db_user, db_pass
        │
        ▼
5. Tenant admin receives login email
        │
        ▼
6. Tenant admin logs in, customizes settings
        │
        ▼
7. Tenant invites employees
        │
        ▼
8. Ready for idea submissions!
```

---

## 6. Scaling Strategy & Projections

### IFQM's Target Scale

```
Current State:        Future State:
─────────────         ─────────────
1 Tenant             100+ Tenants (MSMEs)
50 Users             1000+ users per tenant
100 Ideas/month      10,000+ ideas/month
1 Server             Distributed infrastructure
```

### Scaling Challenges

| Challenge | Description | Mitigation |
|-----------|------------|------------|
| **Database Connections** | Each tenant needs own connection | Connection pooling |
| **Storage Growth** | Ideas + attachments per tenant | CDN for attachments |
| **Query Performance** | More users = more queries | Caching layer |
| **Multi-Tenancy Overhead** | Tenant resolution on every request | Cached resolution |
| **Email Volume** | Notifications per idea action | Email queue + batching |
| **Session Management** | Many concurrent sessions | Redis session store |

### Capacity Planning

Based on 500 MSMEs with 1,000 users each:

```
Peak Concurrent Users: 500 MSMEs × 50 (10% online) = 25,000 concurrent
Ideas per Day: 500 MSMEs × 30 (avg) = 15,000 ideas/day
Votes per Day: 15,000 ideas × 10 votes = 150,000 votes/day
Comments per Day: 15,000 × 2 = 30,000 comments/day

Storage Requirements (Year 1):
─────────────────────────────
Users: 500,000 × 1 KB = 500 MB
Ideas: 5,000,000 × 10 KB = 50 GB
Attachments: 100,000 × 5 MB = 500 GB
Votes/Comments: 10M records × 0.5 KB = 5 GB
Total Year 1: ~555 GB (with overhead: ~1 TB)
```

---

## 7. Database Decisions: SQL vs NoSQL

### Current Choice: MySQL (Relational SQL)

**Why MySQL was chosen for this application:**

| Factor | MySQL Advantage |
|--------|----------------|
| **Data Integrity** | Foreign keys prevent orphan records |
| **Structured Data** | Ideas, users, votes have fixed schemas |
| **ACID Compliance** | Transactions ensure consistency |
| **Mature Technology** | 25+ years of production hardening |
| **Team Expertise** | PHP developers know MySQL well |
| **Cost** | Free, open-source, well-supported |
| **Scaling Tools** | Read replicas, sharding, partitioning |

### Comparison: MySQL vs PostgreSQL vs NoSQL

| Criteria | MySQL | PostgreSQL | MongoDB (NoSQL) |
|----------|-------|------------|-----------------|
| **Schema Flexibility** | Fixed | Fixed | Flexible |
| **Complex Queries** | Excellent | Excellent | Limited |
| **Joins** | Fast | Fast | Manual/expensive |
| **Write Performance** | Good | Good | Excellent |
| **Horizontal Scaling** | Via sharding | Via citus | Native |
| **Multi-Tenant** | One DB per tenant | One DB per tenant | One collection per tenant |
| **Cost** | Free | Free | Atlas ~$60/month |
| **JSON Support** | Good (8.0+) | Excellent | Native |

### Recommendation: Stay with MySQL

For IFQM's use case, MySQL is the **correct choice**:

1. **Relational data is inherently structured:**
   - Users have roles
   - Ideas have submitters and reviewers
   - Votes have idea_id and user_id (relationships matter)

2. **Transactions are critical:**
   - Password changes must be atomic
   - Idea submissions should not be partial
   - Payment/reward systems need ACID

3. **NoSQL doesn't provide clear advantages:**
   - Schema flexibility = not needed (schemas are stable)
   - Horizontal scaling = can achieve with MySQL clustering
   - Document storage = can use JSON columns if needed

4. **Scaling MySQL:**
   - **Read Replicas** (1 primary + 3 replicas): Handles 4x reads
   - **Sharding** (by tenant_id): Horizontal partition
   - **Partitioning** (by date): Faster queries on large tables
   - **Connection Pooling** (ProxySQL): Efficient connection reuse

### Database Scaling Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  RECOMMENDED SCALING ARCHITECTURE            │
└─────────────────────────────────────────────────────────────┘

                        ┌─────────────┐
                        │  Load       │
                        │  Balancer   │
                        │  (HAProxy)  │
                        └──────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │ Web      │    │ Web      │    │ Web      │
        │ Server 1 │    │ Server 2 │    │ Server 3 │
        │ (Apache) │    │ (Apache) │    │ (Apache) │
        └─────┬────┘    └─────┬────┘    └─────┬────┘
              │               │               │
              └───────────────┼───────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   ProxySQL        │
                    │ (Connection Pool) │
                    └─────────┬─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Primary DB   │◄────►│ Read Replica │◄────►│ Read Replica │
│ (Write)      │      │ (Read 1)    │      │ (Read 2)    │
└──────────────┘      └──────────────┘      └──────────────┘
```

### For Extreme Scale (>100 tenants, >100K users):

Consider **Citus extension for PostgreSQL** or **Vitess** (MySQL sharding):

```
┌─────────────────────────────────────────────────────────────┐
│                    VITESS CLUSTER (MySQL Sharding)           │
└─────────────────────────────────────────────────────────────┘

                    ┌──────────────┐
                    │   VTGate     │
                    │ (Query Router)│
                    └──────┬───────┘
                           │
        ┌────────┬─────────┼─────────┬────────┐
        │        │         │         │        │
        ▼        ▼         ▼         ▼        ▼
   ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐
   │Shard 1 ││Shard 2 ││Shard 3 ││Shard 4 ││Shard 5 │
   │(Tenants││(Tenants││(Tenants││(Tenants││(Tenants│
   │  1-50) ││ 51-100)││101-150)││151-200)││201-250)│
   └────────┘└────────┘└────────┘└────────┘└────────┘

- Automatic query routing
- Horizontal scaling
- Connection pooling
- Read/write splitting
```

---

## 8. Deployment Architecture

### Recommended Production Stack

```
┌─────────────────────────────────────────────────────────────┐
│                  PRODUCTION DEPLOYMENT                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        CDN (CloudFlare)                      │
│              - Static asset caching                          │
│              - DDoS protection                               │
│              - SSL termination                               │
└─────────────────────────────────────────────────────────────┘
                               │
┌─────────────────────────────────────────────────────────────┐
│                    Load Balancer (AWS ALB)                   │
│              - Health checks                                  │
│              - Auto-scaling                                  │
│              - SSL offloading                                │
└─────────────────────────────────────────────────────────────┘
                               │
┌─────────────────────────────────────────────────────────────┐
│              Auto Scaling Group (3-10 instances)             │
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│   │  App Server │  │  App Server │  │  App Server │         │
│   │  (Apache)   │  │  (Apache)   │  │  (Apache)   │         │
│   │  + PHP 8.x  │  │  + PHP 8.x  │  │  + PHP 8.x  │         │
│   └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
                               │
┌─────────────────────────────────────────────────────────────┐
│                    Redis Cluster (Session/Cache)             │
│              - PHP sessions                                  │
│              - API response cache                            │
│              - Rate limiting                                 │
└─────────────────────────────────────────────────────────────┘
                               │
┌─────────────────────────────────────────────────────────────┐
│                    MySQL/RDS Cluster                         │
│              - Primary (writes)                              │
│              - 2 Read Replicas (reads)                       │
│              - Automated backups                              │
│              - Multi-AZ failover                             │
└─────────────────────────────────────────────────────────────┘
                               │
┌─────────────────────────────────────────────────────────────┐
│                    Object Storage (S3)                       │
│              - File attachments                              │
│              - Export files                                  │
└─────────────────────────────────────────────────────────────┘
```

### Infrastructure Configuration

```yaml
# Production Environment
Web Servers:
  - Instance: t3.medium (2 vCPU, 4 GB RAM)
  - Auto-scaling: 3-10 instances
  - Health check: /api/auth.php?action=me
  
Database:
  - Primary: db.r6g.large (2 vCPU, 16 GB RAM)
  - Replicas: 2x db.r6g.large
  - Storage: 500 GB gp3 (auto-scaling)
  - Backup: Daily automated, 30-day retention

Cache:
  - Redis: cache.r6g.large (2 vCPU, 16 GB RAM)
  - Cluster mode: 3 nodes
  
Monitoring:
  - CloudWatch (AWS native)
  - Sentry (error tracking)
  - Grafana (dashboards)
```

### Deployment Steps

```
PHASE 1: Infrastructure Setup (Week 1)
├── Set up AWS account and VPC
├── Create RDS MySQL instance
├── Set up ElastiCache (Redis)
├── Configure S3 bucket
└── Set up CI/CD pipeline (GitHub Actions)

PHASE 2: Application Deployment (Week 2)
├── Deploy application code
├── Configure environment variables
├── Set up domain and SSL
├── Test database connections
└── Verify all API endpoints

PHASE 3: Data Migration (Week 3)
├── Export current data
├── Import to new RDS
├── Verify data integrity
├── Update DNS records
└── Go live!

PHASE 4: Monitoring & Optimization (Week 4)
├── Set up CloudWatch dashboards
├── Configure alerts
├── Performance testing
├── Load testing
└── Documentation
```

---

## 9. Cost Projections

### Monthly Operating Costs (500 MSMEs, 1,000 users each)

```
┌─────────────────────────────────────────────────────────────┐
│                    MONTHLY COST BREAKDOWN                   │
└─────────────────────────────────────────────────────────────┘

AWS Infrastructure:
───────────────────────────────────────────────────────────────
EC2 App Servers (t3.medium × 5 avg)
  - 5 × $0.048/hour × 24 × 30 = $173/month
  
RDS MySQL (db.r6g.large)
  - $0.276/hour × 24 × 30 = $198/month
  
RDS Read Replicas (db.r6g.large × 2)
  - $0.276/hour × 2 × 24 × 30 = $397/month
  
ElastiCache Redis (cache.r6g.large)
  - $0.192/hour × 24 × 30 = $138/month
  
EBS Storage (500 GB gp3)
  - $0.08/GB × 500 = $40/month
  
Data Transfer (estimated)
  - 10 TB/month × $0.09 = $900/month

CloudFront CDN
  - $0.0085/GB × 1000 GB = $8.50/month

Subtotal Infrastructure: $1,855/month

┌─────────────────────────────────────────────────────────────┐
│                        ADDITIONAL COSTS                      │
└─────────────────────────────────────────────────────────────┘

Monitoring & Logging:
  - CloudWatch ($50/month)
  - DataDog ($200/month)

SSL Certificates:
  - AWS ACM (Free)

Support:
  - AWS Business Support: $100/month (basic)

TOTAL MONTHLY: ~$2,205/month
```

### Cost by Tenant (500 MSMEs)

```
Per Tenant Cost: $2,205 / 500 = $4.41/month per MSME

Breakdown per 1,000-user tenant:
- Infrastructure: $4.41
- Support margin: $0.50
- Total: $4.91/month per tenant

If passed to MSME at cost: ₹370/month (~$4.50)
If marked up 20%: ₹445/month (~$5.40)
```

### Detailed Cost Table by Scale

| Scale | Users/Tenant | Tenants | Monthly Cost | Per Tenant |
|-------|-------------|---------|--------------|------------|
| Startup | 100 | 10 | $150 | $15.00 |
| Growth | 500 | 50 | $600 | $12.00 |
| Scale | 1,000 | 500 | $2,205 | $4.41 |
| Enterprise | 5,000 | 1,000 | $8,500 | $8.50 |

### One-Time Costs

```
Development & Setup:
  - Infrastructure setup: $2,000
  - CI/CD pipeline: $500
  - Data migration: $1,500
  - Testing & QA: $2,000
  - Documentation: $500
  - Training: $1,000

TOTAL ONE-TIME: $7,500
```

### Cost Optimization Strategies

| Strategy | Savings | Implementation |
|----------|---------|----------------|
| **Reserved Instances** | 40% | 1-year commitment |
| **Spot Instances** | 70% | For non-critical workloads |
| **Auto-scaling** | 30% | Scale down off-peak |
| **Compress images** | 20% storage | On upload |
| **Cache API responses** | 50% DB reads | Redis cache |

---

## 10. Recommendations for IFQM

### Immediate Actions (Before Launch)

1. **Configure SMTP Properly**
   - Set up SendGrid/AWS SES for transactional emails
   - Current mailer.php works but needs proper credentials
   - Email notifications are critical for user engagement

2. **Enable HTTPS**
   - Already have SSL in Apache config
   - Force HTTPS redirect
   - Update cookie settings for security

3. **Set Up Monitoring**
   - Error logging to Sentry
   - Performance monitoring
   - Uptime monitoring (UptimeRobot)

4. **Create Admin Documentation**
   - How to add users
   - How to configure settings
   - How to handle support tickets

### Short-Term Enhancements (3-6 months)

1. **Add Mobile App**
   - React Native for iOS/Android
   - Same API, native UI
   - Push notifications

2. **Implement Advanced Analytics**
   - Real-time dashboards
   - Predictive insights
   - Custom reports

3. **Add AI Enhancement**
   - Integrate Gemini API properly
   - Sentiment analysis on ideas
   - Duplicate detection

### Long-Term Roadmap (1-2 years)

1. **Microservices Architecture**
   - Break into: Auth, Ideas, Notifications, Analytics
   - Independent scaling
   - Technology flexibility

2. **Multi-Region Deployment**
   - Primary: ap-south-1 (Mumbai)
   - DR: ap-southeast-1 (Singapore)
   - Latency optimization

3. **Enterprise Features**
   - SSO (SAML/OAuth)
   - Advanced permissions
   - Custom branding (white-label)

### Technical Debt to Address

```
HIGH PRIORITY:
├── Implement proper error handling
├── Add request validation layer
├── Implement API rate limiting
└── Add comprehensive logging

MEDIUM PRIORITY:
├── Add database migrations tool
├── Implement feature flags
├── Add A/B testing framework
└── Improve test coverage

LOW PRIORITY:
├── Refactor monolithic JavaScript
├── Add service worker for offline
├── Implement CQRS pattern
└── Add GraphQL API
```

### Security Recommendations

1. **Penetration Testing**
   - Hire security firm before launch
   - Focus on authentication and authorization
   - Test multi-tenancy data isolation

2. **Compliance**
   - GDPR considerations (if EU users)
   - SOC 2 Type II certification
   - Regular security audits

3. **Infrastructure Security**
   - VPC isolation
   - IAM roles (no root access)
   - Regular security patches

---

## Appendix A: API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth.php?action=login` | POST | User authentication |
| `/api/auth.php?action=logout` | POST | End session |
| `/api/auth.php?action=forgot_password` | POST | Request reset |
| `/api/auth.php?action=reset_password` | POST | Complete reset |
| `/api/ideas.php?action=list` | GET | List ideas |
| `/api/ideas.php?action=my` | GET | User's ideas |
| `/api/ideas.php?action=review` | GET | Review queue |
| `/api/ideas.php?action=submit` | POST | Create idea |
| `/api/votes.php?action=upvote` | POST | Upvote |
| `/api/votes.php?action=downvote` | POST | Downvote |
| `/api/votes.php?action=vote` | POST | 5-star rating |
| `/api/comments.php?action=list` | GET | List comments |
| `/api/comments.php?action=add` | POST | Add comment |
| `/api/users.php?action=leaderboard` | GET | Rankings |
| `/api/settings.php?action=get` | GET | Org settings |
| `/api/challenges.php?action=list` | GET | List challenges |
| `/api/platform.php?action=tenants` | GET | List tenants (admin) |

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Tenant** | An organization (MSME) using the platform |
| **Multi-tenancy** | One app serving multiple organizations |
| **CSRF Token** | Security token preventing cross-site request forgery |
| **SLA** | Service Level Agreement (review deadline) |
| **ROI** | Return on Investment (idea value) |
| **Escalation** | Automatic upgrade when review is overdue |
| **Anonymous Mode** | Submit idea without revealing identity |
| **Community Score** | AI score adjusted by user votes |

---

*Document prepared for IFQM presentation to authorities.*
*For technical questions, contact the development team.*