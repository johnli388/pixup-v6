import type { ChannelSummary } from '../../../packages/domain/channels';

type PilotChannel = {
  id: string;
  kind: ChannelSummary['kind'];
  name: string;
  area: string;
  region: string;
  format: string;
  description: string;
  focus: string[];
  experience: string[];
};

// Fictional channel concepts for the directory, not activated venues or inventory.
export const pilotChannels: PilotChannel[] = [
  {
    id: 'sample-la-arts-district',
    kind: 'cvm',
    name: 'Arts District Collect Station',
    area: 'Arts District · Los Angeles, CA',
    region: 'Los Angeles area',
    format: 'Collectible vending machine',
    description:
      'A neighborhood kiosk concept for discovering original art cards and sports editions while exploring the Arts District.',
    focus: ['Original art', 'Sports cards', 'Limited editions'],
    experience: [
      'Browse the cards assigned to the kiosk and choose an available slot.',
      'Review the collectible and complete checkout through your PixUP account.',
      'A confirmed device dispense records physical delivery; uncertain outcomes go to staff review.',
    ],
  },
  {
    id: 'sample-santa-monica-live',
    kind: 'liveup',
    name: 'Santa Monica Live Collect',
    area: 'Downtown Santa Monica, CA',
    region: 'Los Angeles area',
    format: 'Hosted live opening session',
    description:
      'A coastal studio concept where collectors discover fictional pop universes and sports packs through a hosted physical opening.',
    focus: ['K-pop', 'Sports packs', 'Creator stories'],
    experience: [
      'Explore the session lineup and choose a specific physical pack.',
      'After payment, the host records the opening and its recording reference.',
      'Revealed items stay in your vault with pack-to-item history. VIA assessment is a separate step.',
    ],
  },
  {
    id: 'sample-sf-soma-group',
    kind: 'goup',
    name: 'SoMa Collector Circle',
    area: 'SoMa · San Francisco, CA',
    region: 'San Francisco Bay Area',
    format: 'Group collecting and shared shipping',
    description:
      'A group-order concept for Bay Area collectors exploring original characters and gaming worlds, with individual orders and a fixed shipping share.',
    focus: ['Original IP', 'Gaming cards', 'Art editions'],
    experience: [
      'Review the group deadline, available participant slots and fixed shipping terms.',
      'Pledge a slot before the group locks, then pay for your own order when every slot is pledged.',
      'Warehouse dispatch starts after every participant has paid. Delivery addresses stay private.',
    ],
  },
];
